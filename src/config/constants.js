export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  WORKER: 'worker'
}

export const BLAST_SPEEDS = {
  siput: { label: 'Siput', minMs: 30_000, maxMs: 50_000 },
  slow: { label: 'Slow', minMs: 15_000, maxMs: 20_000 },
  santai: { label: 'Santai', minMs: 4_000, maxMs: 6_000 },
  brutal: { label: 'Brutal', minMs: 1_000, maxMs: 3_000 },
  super_brutal: { label: 'Super Brutal', minMs: 100, maxMs: 100, minDevices: 4 }
}

export const WITHDRAW_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
}

export const DB_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
}

export const DEVICE_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected'
}

export const DEFAULT_SETTINGS = {
  worker_rate_per_chat: 1300,
  admin_commission_per_chat: 200,
  default_blast_message: 'Halo! Promo spesial untuk Anda.'
}

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS)
