export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  WORKER: 'worker'
}

export const TARGET_STATUS = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  SENT: 'sent',
  FAILED: 'failed'
}

export const DB_STATUS = {
  STOPPED: 'stopped',
  ACTIVE: 'active'
}

export const DEVICE_STATUS = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  ONLINE: 'online'
}

export const WITHDRAW_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
}

export const PAIRING_METHOD = {
  QR: 'qr',
  CODE: 'code'
}

export const SPEED_RANGES = {
  siput: [30_000, 50_000],
  slow: [15_000, 20_000],
  santai: [4_000, 6_000],
  brutal: [1_000, 3_000],
  super_brutal: [100, 100]
}

export const SUPER_BRUTAL_DEVICE_COUNT = 4
export const JWT_EXPIRES_IN = '7d'
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const DEFAULT_WORKER_RATE_CENTS = 130_000
export const DEFAULT_ADMIN_COMMISSION_CENTS = 20_000
export const DEFAULT_WORKER_REFERRAL_CENTS = 10_000
export const DEFAULT_MIN_WITHDRAW_CENTS = 1_000_000
export const DEFAULT_BLAST_MESSAGE = 'Halo, ini pesan promosi.'
export const IDLE_POLL_MS = 2_000
export const LIVE_LOG_LIMIT = 80
export const WA_RECONNECT_DELAY_MS = 3_000
export const WA_OFFLINE_GRACE_MS = 45_000
export const WA_MAX_RECONNECT_ATTEMPTS = 20
export const BLAST_SCHEDULE_TICK_MS = 15_000
