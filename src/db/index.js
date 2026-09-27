import { mkdirSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { config } from '../config.js'
import {
  DEFAULT_ADMIN_COMMISSION_CENTS,
  DEFAULT_BLAST_MESSAGE,
  DEFAULT_MIN_WITHDRAW_CENTS,
  DEFAULT_WORKER_RATE_CENTS,
  DEFAULT_WORKER_REFERRAL_CENTS,
  ROLES
} from '../constants.js'
import { makeReferralCode } from '../utils/referral.js'
import { SCHEMA_SQL } from './schema.js'

mkdirSync(config.dataDir, { recursive: true })
mkdirSync(config.sessionsDir, { recursive: true })

export const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA_SQL)

const addColumn = (table, column, sqlType) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.some((item) => item.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`)
}

const migrate = () => {
  addColumn('users', 'referred_by_worker_id', 'INTEGER')
  addColumn('users', 'message_limit', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('target_dbs', 'auto_start', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('target_dbs', 'auto_stop', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('target_dbs', 'schedule_start', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('target_dbs', 'schedule_stop', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('target_dbs', 'schedule_start_at', 'TEXT')
  addColumn('target_dbs', 'schedule_stop_at', 'TEXT')
  addColumn('devices', 'pairing_method', 'TEXT')
  addColumn('blast_jobs', 'session_sent', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('settings', 'worker_referral_cents', 'INTEGER NOT NULL DEFAULT 10000')
  addColumn('chat_logs', 'referrer_worker_id', 'INTEGER')
  addColumn('chat_logs', 'worker_referral_cents', 'INTEGER NOT NULL DEFAULT 0')
}

migrate()

export const uniqueReferralCode = () => {
  let code = makeReferralCode()
  while (db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code)) {
    code = makeReferralCode()
  }
  return code
}

export const ensureReferralCode = (userId) => {
  const user = db.prepare('SELECT id, referral_code FROM users WHERE id = ?').get(userId)
  if (!user) return null
  if (user.referral_code) return user.referral_code
  const code = uniqueReferralCode()
  db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId)
  return code
}

const seedSettings = () => {
  const existing = db.prepare('SELECT id FROM settings WHERE id = 1').get()
  if (existing) return
  db.prepare(`
    INSERT INTO settings (
      id, worker_rate_cents, admin_commission_cents, worker_referral_cents,
      blast_message, min_withdraw_cents
    ) VALUES (1, ?, ?, ?, ?, ?)
  `).run(
    DEFAULT_WORKER_RATE_CENTS,
    DEFAULT_ADMIN_COMMISSION_CENTS,
    DEFAULT_WORKER_REFERRAL_CENTS,
    DEFAULT_BLAST_MESSAGE,
    DEFAULT_MIN_WITHDRAW_CENTS
  )
}

const seedSuperAdmin = () => {
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get(ROLES.SUPER_ADMIN)
  if (existing) return
  const passwordHash = bcrypt.hashSync(config.superAdminPassword, 10)
  db.prepare(`
    INSERT INTO users (role, username, password_hash)
    VALUES (?, ?, ?)
  `).run(ROLES.SUPER_ADMIN, config.superAdminUser, passwordHash)
}

const fillReferralCodes = () => {
  const rows = db.prepare(`
    SELECT id FROM users WHERE role IN (?, ?) AND (referral_code IS NULL OR referral_code = '')
  `).all(ROLES.ADMIN, ROLES.WORKER)
  for (const row of rows) ensureReferralCode(row.id)
}

seedSettings()
seedSuperAdmin()
fillReferralCodes()

export const getSettings = () => db.prepare('SELECT * FROM settings WHERE id = 1').get()

export const publicUser = (user) => {
  if (!user) return null
  const { password_hash: _passwordHash, ...rest } = user
  return rest
}

export const sessionDirFor = (workerId, deviceId) =>
  path.join(config.sessionsDir, String(workerId), String(deviceId))
