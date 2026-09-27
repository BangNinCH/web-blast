import { ROLES } from '../constants.js'
import { db, ensureReferralCode, publicUser } from '../db/index.js'

export const getReferralNetwork = (user) => {
  const code = ensureReferralCode(user.id)
  const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  let members = []
  if (user.role === ROLES.ADMIN) {
    members = db.prepare(`
      SELECT
        w.id,
        w.username,
        w.created_at,
        w.referred_by_worker_id,
        (SELECT username FROM users r WHERE r.id = w.referred_by_worker_id) AS invited_by,
        CASE
          WHEN EXISTS (SELECT 1 FROM devices d WHERE d.worker_id = w.id AND d.status = 'online')
          THEN 'online'
          ELSE 'offline'
        END AS wa_status,
        COALESCE((SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'start'), 0) AS total_blast
      FROM users w
      WHERE w.role = ? AND w.referred_by_admin_id = ?
      ORDER BY w.id DESC
    `).all(ROLES.WORKER, user.id)
  } else if (user.role === ROLES.WORKER) {
    members = db.prepare(`
      SELECT
        w.id,
        w.username,
        w.created_at,
        CASE
          WHEN EXISTS (SELECT 1 FROM devices d WHERE d.worker_id = w.id AND d.status = 'online')
          THEN 'online'
          ELSE 'offline'
        END AS wa_status,
        COALESCE((SELECT COUNT(*) FROM blast_logs b WHERE b.worker_id = w.id AND b.status = 'start'), 0) AS total_blast
      FROM users w
      WHERE w.role = ? AND w.referred_by_worker_id = ?
      ORDER BY w.id DESC
    `).all(ROLES.WORKER, user.id)
  }
  return {
    user: publicUser(refreshed),
    referralCode: code,
    members
  }
}

export const resolveReferrer = (rawCode) => {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return null
  const owner = db.prepare(`
    SELECT * FROM users
    WHERE referral_code = ? AND is_active = 1 AND role IN (?, ?)
  `).get(code, ROLES.ADMIN, ROLES.WORKER)
  if (!owner) return null
  if (owner.role === ROLES.ADMIN) {
    return { adminId: owner.id, workerId: null }
  }
  if (!owner.referred_by_admin_id) return null
  return { adminId: owner.referred_by_admin_id, workerId: owner.id }
}
