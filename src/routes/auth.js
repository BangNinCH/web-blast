import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { ROLES } from '../constants.js'
import { db, publicUser, uniqueReferralCode } from '../db/index.js'
import { signToken, authRequired } from '../middleware/auth.js'
import { resolveReferrer } from '../services/referral-network.js'

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {}
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib' })
      return
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim())
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Login gagal' })
      return
    }
    const ok = await bcrypt.compare(String(password), user.password_hash)
    if (!ok) {
      res.status(401).json({ error: 'Login gagal' })
      return
    }
    res.json({ token: signToken(user), user: publicUser(user) })
  } catch {
    res.status(500).json({ error: 'Login gagal' })
  }
})

authRouter.post('/register', async (req, res) => {
  try {
    const { username, password, referralCode } = req.body ?? {}
    if (!username || !password || !referralCode) {
      res.status(400).json({ error: 'Username, password, dan kode referral wajib' })
      return
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: 'Password minimal 6 karakter' })
      return
    }
    const referrer = resolveReferrer(referralCode)
    if (!referrer) {
      res.status(400).json({ error: 'Kode referral tidak valid' })
      return
    }
    const hash = await bcrypt.hash(String(password), 10)
    try {
      const code = uniqueReferralCode()
      const result = db.prepare(`
        INSERT INTO users (
          role, username, password_hash, referral_code, referred_by_admin_id, referred_by_worker_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        ROLES.WORKER,
        String(username).trim(),
        hash,
        code,
        referrer.adminId,
        referrer.workerId
      )
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)
      res.status(201).json({ token: signToken(user), user: publicUser(user) })
    } catch (error) {
      if (String(error?.message).includes('UNIQUE')) {
        res.status(409).json({ error: 'Username sudah dipakai' })
        return
      }
      throw error
    }
  } catch {
    res.status(500).json({ error: 'Registrasi gagal' })
  }
})

authRouter.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ user: publicUser(user) })
})
