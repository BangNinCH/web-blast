import { DB_STATUS, TARGET_STATUS } from '../constants.js'
import { db } from '../db/index.js'
import { formatHHmm } from '../utils/clock.js'
import { emitToRole } from '../socket/index.js'

const pendingFor = (dbId) => db.prepare(`
  SELECT COUNT(*) AS total FROM targets WHERE db_id = ? AND status = ?
`).get(dbId, TARGET_STATUS.PENDING).total

export const syncTargetDbAutomation = () => {
  const active = db.prepare('SELECT * FROM target_dbs WHERE status = ?').all(DB_STATUS.ACTIVE)
  for (const item of active) {
    if (item.auto_stop && pendingFor(item.id) === 0) {
      db.prepare('UPDATE target_dbs SET status = ? WHERE id = ?').run(DB_STATUS.STOPPED, item.id)
      const updated = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(item.id)
      emitToRole('admin', 'db:status', updated)
      emitToRole('super_admin', 'db:status', updated)
    }
  }

  const stillActive = db.prepare('SELECT id FROM target_dbs WHERE status = ?').all(DB_STATUS.ACTIVE)
  if (stillActive.length > 0) return

  const next = db.prepare(`
    SELECT d.id
    FROM target_dbs d
    WHERE d.status = ? AND d.auto_start = 1 AND d.schedule_start = 0
      AND (SELECT COUNT(*) FROM targets t WHERE t.db_id = d.id AND t.status = ?) > 0
    ORDER BY d.id ASC
    LIMIT 1
  `).get(DB_STATUS.STOPPED, TARGET_STATUS.PENDING)
  if (!next) return
  db.prepare('UPDATE target_dbs SET status = ? WHERE id = ?').run(DB_STATUS.ACTIVE, next.id)
  const updated = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(next.id)
  emitToRole('admin', 'db:status', updated)
  emitToRole('super_admin', 'db:status', updated)
}

export const setDbAutomation = (id, { autoStart, autoStop }) => {
  const item = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
  if (!item) throw new Error('Database tidak ditemukan')
  const startFlag = autoStart == null ? item.auto_start : (autoStart ? 1 : 0)
  const stopFlag = autoStop == null ? item.auto_stop : (autoStop ? 1 : 0)
  db.prepare(`
    UPDATE target_dbs SET auto_start = ?, auto_stop = ? WHERE id = ?
  `).run(startFlag, stopFlag, id)
  syncTargetDbAutomation()
  return db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
}

export const setDbSchedule = (id, payload = {}) => {
  const item = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
  if (!item) throw new Error('Database tidak ditemukan')

  const scheduleStart = payload.scheduleStart == null
    ? item.schedule_start
    : (payload.scheduleStart ? 1 : 0)
  const scheduleStop = payload.scheduleStop == null
    ? item.schedule_stop
    : (payload.scheduleStop ? 1 : 0)
  const startAt = payload.scheduleStartAt == null
    ? item.schedule_start_at
    : formatHHmm(payload.scheduleStartAt)
  const stopAt = payload.scheduleStopAt == null
    ? item.schedule_stop_at
    : formatHHmm(payload.scheduleStopAt)

  if (scheduleStart && !startAt) throw new Error('Waktu mulai otomatis wajib')
  if (scheduleStop && !stopAt) throw new Error('Waktu berhenti otomatis wajib')

  db.prepare(`
    UPDATE target_dbs
    SET schedule_start = ?, schedule_stop = ?, schedule_start_at = ?, schedule_stop_at = ?
    WHERE id = ?
  `).run(scheduleStart, scheduleStop, startAt, stopAt, id)
  return db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
}
