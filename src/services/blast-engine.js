import {
  DB_STATUS,
  IDLE_POLL_MS,
  SPEED_RANGES,
  TARGET_STATUS
} from '../constants.js'
import { db, getSettings } from '../db/index.js'
import { logger } from '../logger.js'
import { emitBlastStats } from '../socket/index.js'
import { randomDelay, sleep } from '../utils/referral.js'
import { toWhatsAppJid } from '../utils/phone.js'
import { writeBlastLog } from './blast-logs.js'
import { syncTargetDbAutomation } from './db-automation.js'
import { creditChat } from './wallet.js'
import {
  canUseSuperBrutal,
  pickOnlineDevice,
  sendText
} from './wa-manager.js'

const loops = new Set()

const claimTarget = (workerId) => {
  const run = db.transaction(() => {
    const row = db.prepare(`
      SELECT t.id
      FROM targets t
      JOIN target_dbs d ON d.id = t.db_id
      WHERE t.status = ? AND d.status = ?
      ORDER BY t.id ASC
      LIMIT 1
    `).get(TARGET_STATUS.PENDING, DB_STATUS.ACTIVE)
    if (!row) return null
    const updated = db.prepare(`
      UPDATE targets
      SET status = ?, claimed_by_worker_id = ?
      WHERE id = ? AND status = ?
    `).run(TARGET_STATUS.CLAIMED, workerId, row.id, TARGET_STATUS.PENDING)
    if (updated.changes !== 1) return null
    return db.prepare('SELECT * FROM targets WHERE id = ?').get(row.id)
  })
  return run()
}

const markSent = (targetId) => {
  db.prepare(`
    UPDATE targets SET status = ?, sent_at = datetime('now') WHERE id = ?
  `).run(TARGET_STATUS.SENT, targetId)
}

const markFailed = (targetId) => {
  db.prepare(`
    UPDATE targets SET status = ? WHERE id = ?
  `).run(TARGET_STATUS.FAILED, targetId)
}

const pendingCount = () => db.prepare(`
  SELECT COUNT(*) AS total
  FROM targets t
  JOIN target_dbs d ON d.id = t.db_id
  WHERE t.status = ? AND d.status = ?
`).get(TARGET_STATUS.PENDING, DB_STATUS.ACTIVE).total

const workerStats = (workerId) => {
  const worker = db.prepare('SELECT * FROM users WHERE id = ?').get(workerId)
  const job = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
  const chats = db.prepare('SELECT COUNT(*) AS total FROM chat_logs WHERE worker_id = ?').get(workerId).total
  return {
    workerId,
    adminId: worker?.referred_by_admin_id ?? null,
    isRunning: Boolean(job?.is_running),
    speedMode: job?.speed_mode ?? 'santai',
    pending: pendingCount(),
    chats,
    sessionSent: job?.session_sent ?? 0,
    messageLimit: worker?.message_limit ?? 0,
    superBrutalReady: canUseSuperBrutal(workerId)
  }
}

const upsertJob = (workerId, { speedMode, isRunning, resetSession = false }) => {
  const current = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
  const mode = speedMode ?? current?.speed_mode ?? 'santai'
  const running = isRunning == null ? Boolean(current?.is_running) : isRunning
  const sessionSent = resetSession ? 0 : (current?.session_sent ?? 0)
  db.prepare(`
    INSERT INTO blast_jobs (worker_id, speed_mode, is_running, session_sent)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      speed_mode = excluded.speed_mode,
      is_running = excluded.is_running,
      session_sent = excluded.session_sent
  `).run(workerId, mode, running ? 1 : 0, sessionSent)
}

const bumpSessionSent = (workerId) => {
  db.prepare(`
    UPDATE blast_jobs SET session_sent = session_sent + 1 WHERE worker_id = ?
  `).run(workerId)
}

const runLoop = async (workerId) => {
  if (loops.has(workerId)) return
  loops.add(workerId)

  try {
    while (true) {
      const job = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
      if (!job?.is_running) break

      if (job.speed_mode === 'super_brutal' && !canUseSuperBrutal(workerId)) {
        upsertJob(workerId, { speedMode: job.speed_mode, isRunning: false })
        writeBlastLog({
          workerId,
          adminId: workerStats(workerId).adminId,
          status: 'stop',
          detail: 'Super Brutal tidak tersedia, blast dihentikan'
        })
        emitBlastStats(workerStats(workerId))
        break
      }

      const worker = db.prepare('SELECT * FROM users WHERE id = ?').get(workerId)
      const limit = worker?.message_limit ?? 0
      if (limit > 0 && (job.session_sent ?? 0) >= limit) {
        upsertJob(workerId, { speedMode: job.speed_mode, isRunning: false })
        writeBlastLog({
          workerId,
          adminId: worker.referred_by_admin_id,
          status: 'limit',
          detail: `Limit ${limit} chat tercapai, blast auto stop`
        })
        emitBlastStats(workerStats(workerId))
        break
      }

      const device = pickOnlineDevice(workerId)
      if (!device) {
        emitBlastStats(workerStats(workerId))
        await sleep(IDLE_POLL_MS)
        continue
      }

      const target = claimTarget(workerId)
      if (!target) {
        syncTargetDbAutomation()
        emitBlastStats(workerStats(workerId))
        await sleep(IDLE_POLL_MS)
        continue
      }

      const settings = getSettings()
      try {
        await sendText(device.id, toWhatsAppJid(target.phone), settings.blast_message)
        markSent(target.id)
        bumpSessionSent(workerId)
        creditChat({
          workerId,
          adminId: worker?.referred_by_admin_id ?? null,
          deviceId: device.id,
          targetId: target.id,
          phone: target.phone
        })
        writeBlastLog({
          workerId,
          adminId: worker?.referred_by_admin_id ?? null,
          deviceId: device.id,
          phone: target.phone,
          status: 'sent',
          detail: 'Terkirim'
        })
        syncTargetDbAutomation()
        const after = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
        if (limit > 0 && (after?.session_sent ?? 0) >= limit) {
          upsertJob(workerId, { speedMode: job.speed_mode, isRunning: false })
          writeBlastLog({
            workerId,
            adminId: worker?.referred_by_admin_id ?? null,
            status: 'limit',
            detail: `Limit ${limit} chat tercapai, blast auto stop`
          })
          emitBlastStats(workerStats(workerId))
          break
        }
      } catch (error) {
        logger.warn({ err: error, workerId, targetId: target.id }, 'kirim blast gagal')
        markFailed(target.id)
        writeBlastLog({
          workerId,
          adminId: worker?.referred_by_admin_id ?? null,
          deviceId: device.id,
          phone: target.phone,
          status: 'failed',
          detail: error.message || 'Gagal kirim'
        })
        syncTargetDbAutomation()
      }

      emitBlastStats(workerStats(workerId))
      const latest = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
      const range = SPEED_RANGES[latest?.speed_mode] ?? SPEED_RANGES.santai
      await sleep(randomDelay(range))
    }
  } finally {
    loops.delete(workerId)
    const job = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
    if (job?.is_running) {
      upsertJob(workerId, { speedMode: job.speed_mode, isRunning: false })
    }
    emitBlastStats(workerStats(workerId))
  }
}

export const saveSpeed = (workerId, speedMode) => {
  if (!SPEED_RANGES[speedMode]) {
    throw new Error('Mode kecepatan tidak valid')
  }
  if (speedMode === 'super_brutal' && !canUseSuperBrutal(workerId)) {
    throw new Error('Super Brutal membutuhkan 4 perangkat online dengan nomor WhatsApp yang sama')
  }
  upsertJob(workerId, { speedMode })
  return workerStats(workerId)
}

export const startBlast = (workerId, speedModeArg) => {
  const job = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
  const speedMode = speedModeArg || job?.speed_mode || 'santai'
  if (!SPEED_RANGES[speedMode]) {
    throw new Error('Mode kecepatan tidak valid')
  }
  if (speedMode === 'super_brutal' && !canUseSuperBrutal(workerId)) {
    throw new Error('Super Brutal membutuhkan 4 perangkat online dengan nomor WhatsApp yang sama')
  }
  if (!pickOnlineDevice(workerId)) {
    throw new Error('Tidak ada perangkat aktif. Silakan hubungkan perangkat terlebih dahulu.')
  }
  const worker = db.prepare('SELECT * FROM users WHERE id = ?').get(workerId)
  upsertJob(workerId, { speedMode, isRunning: true, resetSession: true })
  writeBlastLog({
    workerId,
    adminId: worker?.referred_by_admin_id ?? null,
    status: 'start',
    detail: `Blast mulai (${speedMode})`
  })
  runLoop(workerId).catch((error) => {
    logger.error({ err: error, workerId }, 'loop blast berhenti karena error')
    upsertJob(workerId, { speedMode, isRunning: false })
  })
  return workerStats(workerId)
}

export const stopBlast = (workerId) => {
  const job = db.prepare('SELECT * FROM blast_jobs WHERE worker_id = ?').get(workerId)
  const worker = db.prepare('SELECT referred_by_admin_id FROM users WHERE id = ?').get(workerId)
  upsertJob(workerId, { speedMode: job?.speed_mode ?? 'santai', isRunning: false })
  writeBlastLog({
    workerId,
    adminId: worker?.referred_by_admin_id ?? null,
    status: 'stop',
    detail: 'Blast dihentikan'
  })
  const stats = workerStats(workerId)
  emitBlastStats(stats)
  return stats
}

export const getWorkerBlastState = (workerId) => workerStats(workerId)

export const resetRunningJobs = () => {
  db.prepare('UPDATE blast_jobs SET is_running = 0').run()
}
