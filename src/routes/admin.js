import { Router } from 'express'
import { DEVICE_STATUS, ROLES } from '../constants.js'
import { db, getSettings, publicUser } from '../db/index.js'
import { authRequired, requireAdmin } from '../middleware/auth.js'
import { requestWithdraw, saveBank } from '../services/wallet.js'
import { listBlastLogs } from '../services/blast-logs.js'
import { getReferralNetwork } from '../services/referral-network.js'
import { centsFromRupiah } from '../utils/money.js'
import { writeAuditLog } from '../services/audit-log.js'
import { createNotification } from '../services/notifications.js'

export const adminRouter = Router()
adminRouter.use(authRequired, requireAdmin)

adminRouter.get('/dashboard', (req, res) => {
  try {
    const adminId = req.user.id
    const workerCount = db.prepare(`
      SELECT COUNT(*) AS total FROM users WHERE role = ? AND referred_by_admin_id = ?
    `).get(ROLES.WORKER, adminId).total
    const waOnline = db.prepare(`
      SELECT COUNT(*) AS total
      FROM devices d
      JOIN users w ON w.id = d.worker_id
      WHERE w.referred_by_admin_id = ? AND d.status = ?
    `).get(adminId, DEVICE_STATUS.ONLINE).total
    const totalChats = db.prepare(`
      SELECT COUNT(*) AS total FROM chat_logs WHERE admin_id = ?
    `).get(adminId).total
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId)
    const success = db.prepare(`SELECT COUNT(*) AS total FROM blast_logs WHERE admin_id = ? AND status = 'sent'`).get(adminId).total
    const failed = db.prepare(`SELECT COUNT(*) AS total FROM blast_logs WHERE admin_id = ? AND status = 'failed'`).get(adminId).total
    const activeWorkers = db.prepare(`
      SELECT COUNT(*) AS total FROM users WHERE role = ? AND referred_by_admin_id = ? AND is_active = 1
    `).get(ROLES.WORKER, adminId).total
    res.json({
      workerCount,
      activeWorkers,
      waOnline,
      totalChats,
      success,
      failed,
      settings: getSettings(),
      user: publicUser(user),
      logs: listBlastLogs({ adminId })
    })
  } catch {
    res.status(500).json({ error: 'Gagal memuat dashboard' })
  }
})

adminRouter.get('/monitor-jobs', (req, res) => {
  try {
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total_db,
        COALESCE(SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN t.status = 'claimed' THEN 1 ELSE 0 END), 0) AS processing,
        COALESCE(SUM(CASE WHEN t.status = 'sent' THEN 1 ELSE 0 END), 0) AS total_success,
        COALESCE(SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END), 0) AS total_failed
      FROM targets t
      JOIN target_dbs d ON d.id = t.db_id
      WHERE d.status = 'active'
    `).get()

    const workerCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = ? AND referred_by_admin_id = ?
    `).get(ROLES.WORKER, req.user.id).total

    res.json({
      totals: {
        totalDb: Number(totals?.total_db ?? 0),
        pending: Number(totals?.pending ?? 0),
        processing: Number(totals?.processing ?? 0),
        totalSuccess: Number(totals?.total_success ?? 0),
        totalFailed: Number(totals?.total_failed ?? 0)
      },
      workerCount,
      logs: listBlastLogs({ adminId: req.user.id })
    })
  } catch {
    res.status(500).json({ error: 'Gagal memuat Monitor Jobs' })
  }
})

adminRouter.get('/workers', (req, res) => {
  const workers = db.prepare(`
    SELECT
      w.id, w.username, w.balance_cents, w.locked_cents, w.created_at, w.is_active,
      w.message_limit,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id AND d.status = ?) AS wa_online,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id) AS device_count,
      (SELECT COUNT(*) FROM chat_logs c WHERE c.worker_id = w.id) AS total_chats,
      (SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'sent') AS total_success,
      (SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'failed') AS total_failed,
      COALESCE((SELECT is_running FROM blast_jobs b WHERE b.worker_id = w.id), 0) AS is_running
    FROM users w
    WHERE w.role = ? AND w.referred_by_admin_id = ?
    ORDER BY w.id DESC
  `).all(DEVICE_STATUS.ONLINE, ROLES.WORKER, req.user.id)
  res.json({ workers })
})

adminRouter.get('/workers/:id', (req, res) => {
  const workerId = Number(req.params.id)
  const worker = db.prepare(`
    SELECT w.*, a.username AS admin_username
    FROM users w
    LEFT JOIN users a ON a.id = w.referred_by_admin_id
    WHERE w.id = ? AND w.role = ? AND w.referred_by_admin_id = ?
  `).get(workerId, ROLES.WORKER, req.user.id)
  if (!worker) {
    res.status(404).json({ error: 'Worker tidak ditemukan' })
    return
  }
  const devices = db.prepare('SELECT id, phone, pairing_method, status, created_at FROM devices WHERE worker_id = ? ORDER BY id DESC').all(workerId)
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM chat_logs WHERE worker_id = ?) AS total_chats,
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'sent') AS success,
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'failed') AS failed
  `).get(workerId, workerId, workerId)
  const logs = listBlastLogs({ workerId, limit: 30 })
  res.json({ worker: publicUser(worker), devices, counts, logs })
})

adminRouter.get('/activity', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM blast_logs
    WHERE admin_id = ?
    ORDER BY id DESC LIMIT 200
  `).all(req.user.id)
  res.json({ activities: items })
})

adminRouter.get('/network', (req, res) => {
  res.json(getReferralNetwork(req.user))
})

adminRouter.put('/bank', (req, res) => {
  try {
    const { bankName, bankAccount, bankHolder } = req.body ?? {}
    if (!bankName || !bankAccount || !bankHolder) {
      res.status(400).json({ error: 'Data rekening wajib lengkap' })
      return
    }
    const bank = saveBank(req.user.id, { bankName, bankAccount, bankHolder })
    writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'update_bank',
      entityType: 'user',
      entityId: req.user.id,
      detail: 'Data rekening pencairan diperbarui'
    })
    res.json({ bank })
  } catch {
    res.status(500).json({ error: 'Gagal menyimpan rekening' })
  }
})

adminRouter.get('/withdrawals', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC
  `).all(req.user.id)
  res.json({ withdrawals: items })
})

adminRouter.post('/withdrawals', (req, res) => {
  try {
    const amount = centsFromRupiah(req.body?.amountRupiah)
    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Nominal withdraw tidak valid' })
      return
    }
    const withdrawal = requestWithdraw(req.user.id, amount)
    writeAuditLog({
      actorId: req.user.id,
      actorUsername: req.user.username,
      actorRole: req.user.role,
      action: 'withdraw_request',
      entityType: 'withdrawal',
      entityId: withdrawal.id,
      detail: `Mengajukan withdraw sebesar ${amount} cents`
    })
    createNotification({
      userId: req.user.id,
      type: 'withdraw',
      title: 'Withdraw diajukan',
      message: `Permintaan withdraw #${withdrawal.id} berhasil diajukan.`
    })
    res.status(201).json({ withdrawal })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal mengajukan withdraw' })
  }
})
