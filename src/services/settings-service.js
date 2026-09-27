import { getDb, runTransaction } from '../db/database.js'
import { DEFAULT_SETTINGS } from '../config/constants.js'

export const getSetting = (key) => {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return DEFAULT_SETTINGS[key] ?? null

  const raw = row.value
  if (/^\d+$/.test(raw)) return Number(raw)
  if (/^\d+\.\d+$/.test(raw)) return Number(raw)
  return raw
}

export const getAllSettings = () => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all()
  const settings = { ...DEFAULT_SETTINGS }

  for (const row of rows) {
    const num = Number(row.value)
    settings[row.key] = Number.isNaN(num) ? row.value : num
  }

  return settings
}

export const updateSettings = (updates) => {
  const db = getDb()
  const stmt = db.prepare(`
    UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?
  `)

  runTransaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(String(value), key)
    }
  })
  return getAllSettings()
}

export const getRates = () => ({
  workerRate: Number(getSetting('worker_rate_per_chat')),
  adminCommission: Number(getSetting('admin_commission_per_chat')),
  blastMessage: String(getSetting('default_blast_message'))
})
