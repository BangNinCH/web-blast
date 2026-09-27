import { BLAST_SCHEDULE_TICK_MS, DB_STATUS, ROLES } from '../constants.js'
import { db } from '../db/index.js'
import { logger } from '../logger.js'
import { isInScheduleWindow, nowInAppTz, timeToMinutes } from '../utils/clock.js'
import { startBlast, stopBlast } from './blast-engine.js'
import { emitToRole } from '../socket/index.js'

let started = false
const prevDesired = new Map()

const setDbStatus = (id, status) => {
  db.prepare('UPDATE target_dbs SET status = ? WHERE id = ?').run(status, id)
  const updated = db.prepare('SELECT * FROM target_dbs WHERE id = ?').get(id)
  emitToRole('admin', 'db:status', updated)
  emitToRole('super_admin', 'db:status', updated)
}

const startIdleWorkers = () => {
  const workers = db.prepare(`
    SELECT id FROM users WHERE role = ? AND is_active = 1
  `).all(ROLES.WORKER)
  for (const worker of workers) {
    const job = db.prepare('SELECT is_running FROM blast_jobs WHERE worker_id = ?').get(worker.id)
    if (job?.is_running) continue
    try {
      startBlast(worker.id)
    } catch (error) {
      logger.warn({ err: error, workerId: worker.id }, 'jadwal start blast gagal')
    }
  }
}

const stopWorkersIfNoActiveDb = () => {
  const active = db.prepare('SELECT id FROM target_dbs WHERE status = ?').get(DB_STATUS.ACTIVE)
  if (active) return
  const running = db.prepare('SELECT worker_id FROM blast_jobs WHERE is_running = 1').all()
  for (const job of running) {
    try {
      stopBlast(job.worker_id)
    } catch (error) {
      logger.warn({ err: error, workerId: job.worker_id }, 'jadwal stop blast gagal')
    }
  }
}

const desiredActive = (item, nowHHmm) => {
  const startOn = item.schedule_start && timeToMinutes(item.schedule_start_at) != null
  const stopOn = item.schedule_stop && timeToMinutes(item.schedule_stop_at) != null
  if (startOn && stopOn) {
    return isInScheduleWindow(item.schedule_start_at, item.schedule_stop_at, nowHHmm)
  }
  if (startOn) {
    return timeToMinutes(nowHHmm) >= timeToMinutes(item.schedule_start_at)
  }
  return null
}

export const tickBlastSchedule = (now = new Date()) => {
  const { time } = nowInAppTz(now)
  const items = db.prepare(`
    SELECT * FROM target_dbs
    WHERE schedule_start = 1 OR schedule_stop = 1
  `).all()

  for (const item of items) {
    const stopOn = item.schedule_stop && timeToMinutes(item.schedule_stop_at) != null
    const desired = desiredActive(item, time)
    const was = prevDesired.get(item.id)
    if (desired != null) prevDesired.set(item.id, desired)

    if (desired === true) {
      if (item.status !== DB_STATUS.ACTIVE) setDbStatus(item.id, DB_STATUS.ACTIVE)
      if (was !== true) startIdleWorkers()
    }

    const pastStop = stopOn && timeToMinutes(time) >= timeToMinutes(item.schedule_stop_at)
    const shouldStop = (desired === false && stopOn) || (desired == null && pastStop)
    if (shouldStop && item.status === DB_STATUS.ACTIVE) {
      setDbStatus(item.id, DB_STATUS.STOPPED)
      stopWorkersIfNoActiveDb()
    }
  }
}

export const startBlastSchedule = () => {
  if (started) return
  started = true
  tickBlastSchedule()
  setInterval(() => {
    try {
      tickBlastSchedule()
    } catch (error) {
      logger.warn({ err: error }, 'tick jadwal blast gagal')
    }
  }, BLAST_SCHEDULE_TICK_MS)
}
