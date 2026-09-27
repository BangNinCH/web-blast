export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  referral_code TEXT UNIQUE,
  referred_by_admin_id INTEGER,
  referred_by_worker_id INTEGER,
  message_limit INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  locked_cents INTEGER NOT NULL DEFAULT 0,
  bank_name TEXT,
  bank_account TEXT,
  bank_holder TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (referred_by_admin_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  worker_rate_cents INTEGER NOT NULL,
  admin_commission_cents INTEGER NOT NULL,
  worker_referral_cents INTEGER NOT NULL DEFAULT 10000,
  blast_message TEXT NOT NULL,
  min_withdraw_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS target_dbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped',
  auto_start INTEGER NOT NULL DEFAULT 0,
  auto_stop INTEGER NOT NULL DEFAULT 0,
  schedule_start INTEGER NOT NULL DEFAULT 0,
  schedule_stop INTEGER NOT NULL DEFAULT 0,
  schedule_start_at TEXT,
  schedule_stop_at TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  db_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_by_worker_id INTEGER,
  sent_at TEXT,
  UNIQUE(db_id, phone),
  FOREIGN KEY (db_id) REFERENCES target_dbs(id)
);

CREATE INDEX IF NOT EXISTS idx_targets_claim ON targets(status, db_id);
CREATE INDEX IF NOT EXISTS idx_targets_worker ON targets(claimed_by_worker_id);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL,
  phone TEXT,
  pairing_method TEXT,
  session_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_worker ON devices(worker_id, status);

CREATE TABLE IF NOT EXISTS blast_jobs (
  worker_id INTEGER PRIMARY KEY,
  speed_mode TEXT NOT NULL DEFAULT 'santai',
  is_running INTEGER NOT NULL DEFAULT 0,
  session_sent INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL,
  admin_id INTEGER,
  device_id INTEGER,
  target_id INTEGER,
  phone TEXT NOT NULL,
  worker_amount_cents INTEGER NOT NULL,
  admin_amount_cents INTEGER NOT NULL,
  referrer_worker_id INTEGER,
  worker_referral_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_worker ON chat_logs(worker_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_admin ON chat_logs(admin_id);

CREATE TABLE IF NOT EXISTS blast_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL,
  admin_id INTEGER,
  worker_username TEXT,
  device_id INTEGER,
  phone TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blast_logs_worker ON blast_logs(worker_id, id);
CREATE INDEX IF NOT EXISTS idx_blast_logs_admin ON blast_logs(admin_id, id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_username TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, id DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
`
