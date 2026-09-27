import { LIVE_LOG_LIMIT, ROLES } from '../constants.js'
import { db } from '../db/index.js'
import { emitBlastLog } from '../socket/index.js'
import { createNotification } from './notifications.js'
import { writeAuditLog } from './audit-log.js'

const notificationStatuses = new Map([
  ['wa_connected', ['success', 'WhatsApp tersambung', 'Perangkat WhatsApp worker terhubung ke web.']],
  ['wa_disconnected', ['warning', 'WhatsApp terputus', 'Perangkat WhatsApp worker terputus dari web.']],
  ['start', ['info', 'Blast dimulai', 'Worker memulai proses blast.']],
  ['stop', ['warning', 'Blast dihentikan', 'Worker menghentikan proses blast.']],
  ['limit', ['warning', 'Blast auto stop', 'Limit pesan worker tercapai dan blast dihentikan otomatis.']]
])

export const writeBlastLog = ({ workerId, adminId, deviceId, phone, status, detail }) => {
  const worker = db.prepare('SELECT username FROM users WHERE id = ?').get(workerId)
  const result = db.prepare(`
    INSERT INTO blast_logs (worker_id, admin_id, worker_username, device_id, phone, status, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(workerId, adminId ?? null, worker?.username ?? null, deviceId ?? null, phone ?? null, status, detail ?? null)
  const row = db.prepare('SELECT * FROM blast_logs WHERE id = ?').get(result.lastInsertRowid)
  emitBlastLog(row)

  const meta = notificationStatuses.get(status)
  if (meta) {
    const [type, title, message] = meta
    createNotification({ userId: workerId, type, title, message: `${message} ${detail || ''}`.trim() })
    if (adminId) createNotification({ userId: adminId, type, title, message: `${worker?.username || 'Worker'}: ${message}`.trim() })
    const superAdmins = db.prepare('SELECT id FROM users WHERE role = ? AND is_active = 1').all(ROLES.SUPER_ADMIN)
    superAdmins.forEach((item) => createNotification({ userId: item.id, type, title, message: `${worker?.username || 'Worker'}: ${message}`.trim() }))
    writeAuditLog({
      actorId: workerId,
      actorUsername: worker?.username,
      actorRole: ROLES.WORKER,
      action: status,
      entityType: 'blast/device',
      entityId: deviceId ?? null,
      detail: detail || title
    })
  }
  return row
}

export const listBlastLogs = ({ workerId, adminId, limit = LIVE_LOG_LIMIT } = {}) => {
  const size = Math.min(Number(limit) || LIVE_LOG_LIMIT, 200)
  if (workerId) {
    return db.prepare('SELECT * FROM blast_logs WHERE worker_id = ? ORDER BY id DESC LIMIT ?').all(workerId, size)
  }
  if (adminId) {
    return db.prepare('SELECT * FROM blast_logs WHERE admin_id = ? ORDER BY id DESC LIMIT ?').all(adminId, size)
  }
  return db.prepare('SELECT * FROM blast_logs ORDER BY id DESC LIMIT ?').all(size)
}
