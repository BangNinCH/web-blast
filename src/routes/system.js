import { Router } from 'express'
import { authRequired } from '../middleware/auth.js'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount
} from '../services/notifications.js'
import { db } from '../db/index.js'
import { ROLES } from '../constants.js'

export const systemRouter = Router()
systemRouter.use(authRequired)

systemRouter.get('/notifications', (req, res) => {
  res.json({
    notifications: listNotifications(req.user.id),
    unread: Number(unreadNotificationCount(req.user.id) || 0)
  })
})

systemRouter.post('/notifications/read-all', (req, res) => {
  const count = markAllNotificationsRead(req.user.id)
  res.json({ count, unread: 0 })
})

systemRouter.post('/notifications/:id/read', (req, res) => {
  const item = markNotificationRead(req.user.id, Number(req.params.id))
  if (!item) {
    res.status(404).json({ error: 'Notifikasi tidak ditemukan' })
    return
  }
  res.json({ notification: item, unread: Number(unreadNotificationCount(req.user.id) || 0) })
})

systemRouter.get('/search', (req, res) => {
  const q = String(req.query?.q || '').trim()
  if (!q) {
    res.json({ admins: [], workers: [], dbs: [] })
    return
  }
  const pattern = `%${q}%`
  if (req.user.role === ROLES.SUPER_ADMIN) {
    const admins = db.prepare(`
      SELECT id, username, role, referral_code, is_active FROM users
      WHERE role = ? AND (username LIKE ? OR referral_code LIKE ?)
      ORDER BY username LIMIT 20
    `).all(ROLES.ADMIN, pattern, pattern)
    const workers = db.prepare(`
      SELECT w.id, w.username, w.role, w.is_active, a.username AS admin_username
      FROM users w
      LEFT JOIN users a ON a.id = w.referred_by_admin_id
      WHERE w.role = ? AND (w.username LIKE ? OR a.username LIKE ?)
      ORDER BY w.username LIMIT 20
    `).all(ROLES.WORKER, pattern, pattern)
    const dbs = db.prepare(`
      SELECT id, name, status FROM target_dbs
      WHERE name LIKE ? OR CAST(id AS TEXT) LIKE ?
      ORDER BY id DESC LIMIT 20
    `).all(pattern, pattern)
    res.json({ admins, workers, dbs })
    return
  }

  if (req.user.role === ROLES.ADMIN) {
    const workers = db.prepare(`
      SELECT w.id, w.username, w.role, w.is_active, w.balance_cents
      FROM users w
      WHERE w.role = ? AND w.referred_by_admin_id = ?
      AND w.username LIKE ?
      ORDER BY w.username LIMIT 20
    `).all(ROLES.WORKER, req.user.id, pattern)
    res.json({ admins: [], workers, dbs: [] })
    return
  }

  res.json({ admins: [], workers: [], dbs: [] })
})
