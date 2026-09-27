import { db } from '../db/index.js'
import { emitNotification } from '../socket/index.js'

export const createNotification = ({ userId, type = 'info', title, message }) => {
  if (!userId || !title || !message) return null
  const result = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (?, ?, ?, ?)
  `).run(userId, type, title, message)
  const item = db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid)
  emitNotification(userId, item)
  return item
}

export const createNotifications = (userIds, payload) => {
  const unique = [...new Set((userIds || []).map(Number).filter(Boolean))]
  return unique.map((userId) => createNotification({ userId, ...payload })).filter(Boolean)
}

export const listNotifications = (userId, limit = 30) => {
  const size = Math.min(Math.max(Number(limit) || 30, 1), 100)
  return db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(userId, size)
}

export const unreadNotificationCount = (userId) => db.prepare(`
  SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL
`).get(userId).total

export const markNotificationRead = (userId, id) => {
  db.prepare(`
    UPDATE notifications SET read_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(Number(id), userId)
  return db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(Number(id), userId)
}

export const markAllNotificationsRead = (userId) => {
  return db.prepare(`
    UPDATE notifications SET read_at = datetime('now')
    WHERE user_id = ? AND read_at IS NULL
  `).run(userId).changes
}
