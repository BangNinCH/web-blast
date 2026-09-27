import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, ROLES } from '../config/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_DIR = path.join(__dirname, '../../data')
const DB_PATH = path.join(DB_DIR, 'app.db')

let db

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'worker')),
    referral_code TEXT UNIQUE,
    referred_by INTEGER REFERENCES users(id),
    balance REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS target_databases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    total_numbers INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS target_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    database_id INTEGER NOT NULL REFERENCES target_databases(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
    sent_by INTEGER REFERENCES users(id),
    sent_at TEXT,
    UNIQUE(database_id, phone)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    phone_number TEXT,
    session_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_connected_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES users(id),
    admin_id INTEGER REFERENCES users(id),
    database_id INTEGER NOT NULL REFERENCES target_databases(id),
    target_number_id INTEGER NOT NULL REFERENCES target_numbers(id),
    phone TEXT NOT NULL,
    worker_earning REAL NOT NULL DEFAULT 0,
    admin_commission REAL NOT NULL DEFAULT 0,
    device_id INTEGER REFERENCES whatsapp_devices(id),
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS withdraw_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    note TEXT,
    processed_by INTEGER REFERENCES users(id),
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blast_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL REFERENCES users(id),
    database_id INTEGER REFERENCES target_databases(id),
    speed TEXT NOT NULL,
    is_running INTEGER NOT NULL DEFAULT 0,
    total_sent INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    stopped_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
  CREATE INDEX IF NOT EXISTS idx_target_numbers_status ON target_numbers(database_id, status);
  CREATE INDEX IF NOT EXISTS idx_chat_logs_worker ON chat_logs(worker_id);
  CREATE INDEX IF NOT EXISTS idx_chat_logs_admin ON chat_logs(admin_id);
  CREATE INDEX IF NOT EXISTS idx_devices_worker ON whatsapp_devices(worker_id);
`

const generateReferralCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export const runTransaction = (fn) => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const seedSuperAdmin = () => {
  const username = process.env.SUPER_ADMIN_USERNAME ?? 'superadmin'
  const password = process.env.SUPER_ADMIN_PASSWORD ?? 'SuperAdmin123!'
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get(ROLES.SUPER_ADMIN)

  if (existing) return

  const passwordHash = bcrypt.hashSync(password, 10)
  db.prepare(`
    INSERT INTO users (username, password_hash, role, referral_code)
    VALUES (?, ?, ?, ?)
  `).run(username, passwordHash, ROLES.SUPER_ADMIN, generateReferralCode())
}

const seedSettings = () => {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `)

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, String(value))
  }
}

export const initDatabase = () => {
  mkdirSync(DB_DIR, { recursive: true })
  db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(schema)
  seedSettings()
  seedSuperAdmin()
  return db
}

export const getDb = () => {
  if (!db) throw new Error('Database belum diinisialisasi')
  return db
}

export { generateReferralCode }
