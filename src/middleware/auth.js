import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { ROLES } from '../constants.js'
import { db, publicUser } from '../db/index.js'

export const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, username: user.username },
  config.jwtSecret,
  { expiresIn: '7d' }
)

export const readToken = (req) => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  return null
}

export const authRequired = (req, res, next) => {
  try {
    const token = readToken(req)
    if (!token) {
      res.status(401).json({ error: 'Wajib login' })
      return
    }
    const payload = jwt.verify(token, config.jwtSecret)
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id)
    if (!user) {
      res.status(401).json({ error: 'Akun tidak aktif' })
      return
    }
    req.user = publicUser(user)
    next()
  } catch {
    res.status(401).json({ error: 'Sesi tidak valid' })
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    res.status(403).json({ error: 'Akses ditolak' })
    return
  }
  next()
}

export const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN)
export const requireAdmin = requireRole(ROLES.ADMIN)
export const requireWorker = requireRole(ROLES.WORKER)
