import { Router } from 'express'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { MAX_UPLOAD_BYTES, ROLES, DB_STATUS, DEVICE_STATUS } from '../constants.js'
import { db, getSettings, publicUser } from '../db/index.js'
import { authRequired, requireSuperAdmin } from '../middleware/auth.js'
import { listBlastLogs } from '../services/blast-logs.js'
import { setDbAutomation, setDbSchedule, syncTargetDbAutomation } from '../services/db-automation.js'
import { tickBlastSchedule } from '../services/blast-schedule.js'
import { reviewWithdraw } from '../services/wallet.js'
import { monitorPayload } from '../services/wa-manager.js'
import { centsFromRupiah } from '../utils/money.js'
import { normalizePhone } from '../utils/phone.js'
import { makeReferralCode } from '../utils/referral.js'
import { emitToRole, emitToUser } from '../socket/index.js'
import { writeAuditLog } from '../services/audit-log.js'
import { createNotification } from '../services/notifications.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }
})

export const superAdminRouter = Router()
superAdminRouter.use(authRequired, requireSuperAdmin)

const notifyDbStatus = (dbItem, action) => {
  emitToRole('admin', 'db:status', dbItem)
  emitToRole('super_admin', 'db:status', dbItem)
  const title = action === 'start' ? 'Database dimulai' : 'Database dihentikan'
  const message = `${dbItem.name} (#${dbItem.id}) ${action === 'start' ? 'aktif' : 'dihentikan'}.`
  const users = db.prepare('SELECT id, role FROM users WHERE role IN (?, ?) AND is_active = 1').all(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  users.forEach((row) => createNotification({ userId: row.id, type: action === 'start' ? 'success' : 'warning', title, message }))
}

superAdminRouter.get('/monitor', (_req, res) => {
  try {
    const settings = getSettings()
    const totals = {
      admins: db.prepare('SELECT COUNT(*) AS total FROM users WHERE role = ?').get(ROLES.ADMIN).total,
      workers: db.prepare('SELECT COUNT(*) AS total FROM users WHERE role = ?').get(ROLES.WORKER).total,
      pendingWithdrawals: db.prepare(`SELECT COUNT(*) AS total FROM withdrawals WHERE status = 'pending'`).get().total,
      chats: db.prepare('SELECT COUNT(*) AS total FROM chat_logs').get().total,
      pendingTargets: db.prepare(`
        SELECT COUNT(*) AS total FROM targets t
        JOIN target_dbs d ON d.id = t.db_id
        WHERE t.status = 'pending' AND d.status = 'active'
      `).get().total,
      activeDbs: db.prepare(`SELECT COUNT(*) AS total FROM target_dbs WHERE status = 'active'`).get().total,
      workersOnline: db.prepare(`SELECT COUNT(*) AS total FROM devices WHERE status = ?`).get(DEVICE_STATUS.ONLINE).total,
      workerPayrollDueCents: db.prepare(`
        SELECT COALESCE(SUM(balance_cents + locked_cents), 0) AS total
        FROM users
        WHERE role = ?
      `).get(ROLES.WORKER).total,
      adminCommissionDueCents: db.prepare(`
        SELECT COALESCE(SUM(balance_cents + locked_cents), 0) AS total
        FROM users
        WHERE role = ?
      `).get(ROLES.ADMIN).total
    }
    res.json({ settings, totals, logs: listBlastLogs(), ...monitorPayload() })
  } catch {
    res.status(500).json({ error: 'Gagal memuat monitor' })
  }
})

superAdminRouter.get('/db-monitor', (_req, res) => {
  try {
    const aggregate = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN d.status = 'active' THEN 1 ELSE 0 END), 0) AS active_db,
        COALESCE(SUM(CASE WHEN d.status = 'active' AND t.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_db,
        COALESCE(SUM(CASE WHEN t.status = 'pending' AND d.status = 'active' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN t.status = 'claimed' AND d.status = 'active' THEN 1 ELSE 0 END), 0) AS processing,
        COALESCE(SUM(CASE WHEN t.status = 'sent' AND d.status = 'active' THEN 1 ELSE 0 END), 0) AS total_success,
        COALESCE(SUM(CASE WHEN t.status = 'failed' AND d.status = 'active' THEN 1 ELSE 0 END), 0) AS total_failed
      FROM target_dbs d
      LEFT JOIN targets t ON t.db_id = d.id
    `).get()
    const dbs = db.prepare(`
      SELECT
        d.*,
        (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id) AS total,
        (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'pending' AND d.status = 'active') AS pending,
        (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'claimed' AND d.status = 'active') AS processing,
        (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'sent' AND d.status = 'active') AS sent,
        (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'failed' AND d.status = 'active') AS failed
      FROM target_dbs d
      ORDER BY d.id DESC
    `).all()
    res.json({
      totals: {
        totalDb: Number(aggregate.total_db || 0),
        activeDb: Number(aggregate.active_db || 0),
        pending: Number(aggregate.pending || 0),
        processing: Number(aggregate.processing || 0),
        totalSuccess: Number(aggregate.total_success || 0),
        totalFailed: Number(aggregate.total_failed || 0)
      },
      dbs,
      logs: listBlastLogs()
    })
  } catch {
    res.status(500).json({ error: 'Gagal memuat Pantau DB' })
  }
})

superAdminRouter.get('/admins', (_req, res) => {
  const admins = db.prepare(`
    SELECT
      a.*,
      (SELECT COUNT(*) FROM users w WHERE w.referred_by_admin_id = a.id AND w.role = ?) AS worker_count,
      (SELECT COUNT(*) FROM users w WHERE w.referred_by_admin_id = a.id AND w.role = ? AND w.is_active = 1) AS active_worker_count
    FROM users a
    WHERE a.role = ?
    ORDER BY a.id DESC
  `).all(ROLES.WORKER, ROLES.WORKER, ROLES.ADMIN)
  res.json({ admins: admins.map(publicUser) })
})

superAdminRouter.post('/admins', async (req, res) => {
  try {
    const { username, password } = req.body ?? {}
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib' })
      return
    }
    const hash = await bcrypt.hash(String(password), 10)
    let code = makeReferralCode()
    while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) code = makeReferralCode()
    const result = db.prepare(`
      INSERT INTO users (role, username, password_hash, referral_code)
      VALUES (?, ?, ?, ?)
    `).run(ROLES.ADMIN, String(username).trim(), hash, code)
    const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'create_admin', entityType: 'user', entityId: admin.id,
      detail: `Admin ${admin.username} dibuat`
    })
    createNotification({ userId: admin.id, type: 'success', title: 'Akun admin dibuat', message: 'Akun admin kamu sudah dibuat oleh Super Admin.' })
    res.status(201).json({ admin: publicUser(admin) })
  } catch (error) {
    if (String(error?.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'Username sudah dipakai' })
      return
    }
    res.status(500).json({ error: 'Gagal menambah admin' })
  }
})

superAdminRouter.patch('/users/:id/status', (req, res) => {
  try {
    const id = Number(req.params.id)
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND role IN (?, ?)').get(id, ROLES.ADMIN, ROLES.WORKER)
    if (!user) {
      res.status(404).json({ error: 'User tidak ditemukan' })
      return
    }
    const active = req.body?.isActive ? 1 : 0
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, id)
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: active ? 'activate_user' : 'deactivate_user', entityType: 'user', entityId: id,
      detail: `${user.role} ${user.username} ${active ? 'diaktifkan' : 'dinonaktifkan'}`
    })
    createNotification({
      userId: id,
      type: active ? 'success' : 'warning',
      title: active ? 'Akun diaktifkan' : 'Akun dinonaktifkan',
      message: active ? 'Akun kamu kembali aktif.' : 'Akun kamu dinonaktifkan oleh Super Admin.'
    })
    emitToUser(id, 'account:status', { isActive: Boolean(active) })
    res.json({ user: publicUser(updated) })
  } catch {
    res.status(500).json({ error: 'Gagal mengubah status user' })
  }
})

superAdminRouter.patch('/users/:id/password', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const password = String(req.body?.password || '')
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND role IN (?, ?)').get(id, ROLES.ADMIN, ROLES.WORKER)
    if (!user) {
      res.status(404).json({ error: 'User tidak ditemukan' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password minimal 6 karakter' })
      return
    }
    const hash = await bcrypt.hash(password, 10)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id)
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'reset_password', entityType: 'user', entityId: id,
      detail: `Password ${user.role} ${user.username} direset`
    })
    createNotification({ userId: id, type: 'warning', title: 'Password direset', message: 'Password akun kamu direset oleh Super Admin.' })
    emitToUser(id, 'account:security', { action: 'password_reset' })
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Gagal mereset password' })
  }
})

superAdminRouter.get('/workers', (_req, res) => {
  const workers = db.prepare(`
    SELECT
      w.id, w.username, w.role, w.balance_cents, w.locked_cents, w.created_at, w.is_active,
      w.referral_code, w.message_limit,
      w.referred_by_admin_id,
      a.username AS admin_username,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id AND d.status = ?) AS wa_online,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id) AS device_count,
      (SELECT COUNT(*) FROM chat_logs c WHERE c.worker_id = w.id) AS total_chats,
      (SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'sent') AS total_success,
      (SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'failed') AS total_failed,
      COALESCE((SELECT is_running FROM blast_jobs b WHERE b.worker_id = w.id), 0) AS is_running
    FROM users w
    LEFT JOIN users a ON a.id = w.referred_by_admin_id
    WHERE w.role = ?
    ORDER BY w.id DESC
  `).all(DEVICE_STATUS.ONLINE, ROLES.WORKER)
  res.json({ workers })
})

superAdminRouter.get('/audit-logs', (_req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all()
  res.json({ logs })
})

superAdminRouter.get('/health', (_req, res) => {
  try {
    const memory = process.memoryUsage()
    const integrity = db.prepare('PRAGMA integrity_check').get()
    const activeDbs = db.prepare(`SELECT COUNT(*) AS total FROM target_dbs WHERE status = 'active'`).get().total
    const connectedDevices = db.prepare('SELECT COUNT(*) AS total FROM devices WHERE status = ?').get(DEVICE_STATUS.ONLINE).total
    const runningJobs = db.prepare('SELECT COUNT(*) AS total FROM blast_jobs WHERE is_running = 1').get().total
    const uptime = process.uptime()
    const heapUsed = Math.round((memory.heapUsed / memory.heapTotal) * 100)
    res.json({
      server: { status: 'online', uptime, node: process.version, memoryMb: Math.round(memory.rss / 1024 / 1024), heapUsedPercent: heapUsed },
      database: { status: integrity?.integrity_check === 'ok' ? 'online' : 'warning', integrity: integrity?.integrity_check || 'unknown', activeDbs },
      websocket: { status: 'online' },
      whatsapp: { online: connectedDevices },
      blast: { running: runningJobs }
    })
  } catch {
    res.status(500).json({ error: 'Gagal memuat system health' })
  }
})

superAdminRouter.get('/dbs', (_req, res) => {
  const items = db.prepare(`
    SELECT
      d.*,
      (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id) AS total,
      (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'pending') AS pending,
      (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'sent') AS sent,
      (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = 'failed') AS failed
    FROM target_dbs d
    ORDER BY d.id DESC
  `).all()
  res.json({ dbs: items })
})

superAdminRouter.post('/dbs', upload.single('file'), (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'Nama database wajib' })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'File .txt wajib' })
      return
    }
    const text = req.file.buffer.toString('utf8')
    const lines = text.split(/\r?\n/)
    const phones = []
    const seen = new Set()
    for (const line of lines) {
      const phone = normalizePhone(line)
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      phones.push(phone)
    }
    if (!phones.length) {
      res.status(400).json({ error: 'Tidak ada nomor valid di file' })
      return
    }
    const created = db.transaction(() => {
      const result = db.prepare('INSERT INTO target_dbs (name, status) VALUES (?, ?)').run(name, DB_STATUS.STOPPED)
      const dbId = Number(result.lastInsertRowid)
      const insert = db.prepare('INSERT INTO targets (db_id, phone) VALUES (?, ?)')
      for (const phone of phones) insert.run(dbId, phone)
      return db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(dbId)
    })()
    syncTargetDbAutomation()
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'upload_db', entityType: 'target_db', entityId: created.id,
      detail: `Database ${created.name} diunggah, ${phones.length} target`
    })
    res.status(201).json({ db: created, imported: phones.length })
  } catch {
    res.status(500).json({ error: 'Gagal mengunggah database' })
  }
})

superAdminRouter.post('/dbs/:id/start', (req, res) => {
  try {
    const id = Number(req.params.id)
    const item = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
    if (!item) {
      res.status(404).json({ error: 'Database tidak ditemukan' })
      return
    }
    db.prepare('UPDATE target_dbs SET status = ? WHERE id = ?').run(DB_STATUS.ACTIVE, id)
    const updated = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
    notifyDbStatus(updated, 'start')
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'start_db', entityType: 'target_db', entityId: id, detail: `${updated.name} dimulai`
    })
    res.json({ db: updated })
  } catch {
    res.status(500).json({ error: 'Gagal start database' })
  }
})

superAdminRouter.post('/dbs/:id/stop', (req, res) => {
  try {
    const id = Number(req.params.id)
    const item = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
    if (!item) {
      res.status(404).json({ error: 'Database tidak ditemukan' })
      return
    }
    db.prepare('UPDATE target_dbs SET status = ? WHERE id = ?').run(DB_STATUS.STOPPED, id)
    const updated = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
    notifyDbStatus(updated, 'stop')
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'stop_db', entityType: 'target_db', entityId: id, detail: `${updated.name} dihentikan`
    })
    res.json({ db: updated })
  } catch {
    res.status(500).json({ error: 'Gagal stop database' })
  }
})

superAdminRouter.post('/dbs/:id/auto', (req, res) => {
  try {
    const item = setDbAutomation(Number(req.params.id), { autoStart: req.body?.autoStart, autoStop: req.body?.autoStop })
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'update_db_automation', entityType: 'target_db', entityId: item.id,
      detail: `Auto start=${Boolean(item.auto_start)} auto stop=${Boolean(item.auto_stop)}`
    })
    res.json({ db: item })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal mengatur auto DB' })
  }
})

superAdminRouter.post('/dbs/:id/schedule', (req, res) => {
  try {
    const item = setDbSchedule(Number(req.params.id), {
      scheduleStart: req.body?.scheduleStart,
      scheduleStop: req.body?.scheduleStop,
      scheduleStartAt: req.body?.scheduleStartAt,
      scheduleStopAt: req.body?.scheduleStopAt
    })
    tickBlastSchedule()
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: 'update_db_schedule', entityType: 'target_db', entityId: item.id,
      detail: `Jadwal start=${item.schedule_start_at || '-'} stop=${item.schedule_stop_at || '-'}`
    })
    res.json({ db: db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(item.id) })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal menyimpan jadwal' })
  }
})

superAdminRouter.get('/logs', (_req, res) => {
  res.json({ logs: listBlastLogs() })
})

superAdminRouter.get('/settings', (_req, res) => {
  res.json({ settings: getSettings() })
})

superAdminRouter.put('/settings', (req, res) => {
  try {
    const current = getSettings()
    const workerRate = req.body?.workerRateRupiah
    const adminCommission = req.body?.adminCommissionRupiah
    const workerReferral = req.body?.workerReferralRupiah
    const minWithdraw = req.body?.minWithdrawRupiah
    const blastMessage = req.body?.blastMessage
    db.prepare(`
      UPDATE settings SET
        worker_rate_cents = ?, admin_commission_cents = ?, worker_referral_cents = ?,
        blast_message = ?, min_withdraw_cents = ? WHERE id = 1
    `).run(
      workerRate == null ? current.worker_rate_cents : centsFromRupiah(workerRate),
      adminCommission == null ? current.admin_commission_cents : centsFromRupiah(adminCommission),
      workerReferral == null ? (current.worker_referral_cents ?? 0) : centsFromRupiah(workerReferral),
      blastMessage == null ? current.blast_message : String(blastMessage),
      minWithdraw == null ? current.min_withdraw_cents : centsFromRupiah(minWithdraw)
    )
    writeAuditLog({ actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role, action: 'update_settings', entityType: 'settings', entityId: 1, detail: 'Pengaturan sistem diperbarui' })
    res.json({ settings: getSettings() })
  } catch {
    res.status(500).json({ error: 'Gagal menyimpan pengaturan' })
  }
})

superAdminRouter.get('/withdrawals', (_req, res) => {
  const items = db.prepare(`
    SELECT w.*, u.username, u.role, u.bank_name, u.bank_account, u.bank_holder
    FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.id DESC
  `).all()
  res.json({ withdrawals: items })
})

const reviewWithdrawal = (req, res, accept) => {
  try {
    const item = reviewWithdraw(Number(req.params.id), accept)
    writeAuditLog({
      actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role,
      action: accept ? 'accept_withdrawal' : 'reject_withdrawal', entityType: 'withdrawal', entityId: item.id,
      detail: `Withdraw ${item.id} ${accept ? 'diterima' : 'ditolak'}`
    })
    createNotification({
      userId: item.user_id,
      type: accept ? 'success' : 'warning',
      title: accept ? 'Withdraw diterima' : 'Withdraw ditolak',
      message: `Pengajuan withdraw #${item.id} ${accept ? 'diterima' : 'ditolak'}.`
    })
    res.json({ withdrawal: item })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal memproses withdraw' })
  }
}

superAdminRouter.post('/withdrawals/:id/accept', (req, res) => reviewWithdrawal(req, res, true))
superAdminRouter.post('/withdrawals/:id/reject', (req, res) => reviewWithdrawal(req, res, false))
