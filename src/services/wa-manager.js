import { rm } from 'node:fs/promises'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@rexxhayanasi/elaina-baileys'
import QRCode from 'qrcode'
import {
  DEVICE_STATUS,
  PAIRING_METHOD,
  ROLES,
  SUPER_BRUTAL_DEVICE_COUNT,
  WA_MAX_RECONNECT_ATTEMPTS,
  WA_OFFLINE_GRACE_MS,
  WA_RECONNECT_DELAY_MS
} from '../constants.js'
import { db, sessionDirFor } from '../db/index.js'
import { logger } from '../logger.js'
import { emitDeviceStatus } from '../socket/index.js'
import { writeBlastLog } from './blast-logs.js'
import { sleep } from '../utils/referral.js'
import { extractPhoneFromJid, normalizePhone } from '../utils/phone.js'

const sessions = new Map()
const connectLocks = new Map()
const offlineTimers = new Map()
const reconnectTimers = new Map()
const reconnectAttempts = new Map()

const getDevice = (deviceId) => db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId)

const withLiveFields = (device) => {
  if (!device) return null
  const session = sessions.get(device.id)
  return {
    ...device,
    ready: Boolean(session?.ready),
    qr: session?.qr ?? null,
    pairingCode: session?.pairingCode ?? null
  }
}

const publishDevice = (device) => {
  const payload = withLiveFields(device)
  if (payload) emitDeviceStatus(payload)
  return payload
}

const saveDevice = (deviceId, patch = {}) => {
  const current = getDevice(deviceId)
  if (!current) return null
  const nextPhone = Object.hasOwn(patch, 'phone') ? patch.phone : current.phone
  const nextStatus = patch.status ?? current.status
  const nextDir = patch.sessionDir ?? current.session_dir
  const nextMethod = patch.pairingMethod ?? current.pairing_method
  const unchanged = nextPhone === current.phone
    && nextStatus === current.status
    && nextDir === current.session_dir
    && nextMethod === current.pairing_method
  if (unchanged) return current

  db.prepare(`
    UPDATE devices
    SET phone = ?, status = ?, session_dir = ?, pairing_method = ?
    WHERE id = ?
  `).run(nextPhone, nextStatus, nextDir, nextMethod, deviceId)

  const updated = getDevice(deviceId)

  if (current.status === DEVICE_STATUS.ONLINE && nextStatus === DEVICE_STATUS.OFFLINE) {
    const worker = db.prepare('SELECT referred_by_admin_id FROM users WHERE id = ?').get(current.worker_id)
    writeBlastLog({
      workerId: current.worker_id,
      adminId: worker?.referred_by_admin_id ?? null,
      deviceId: current.id,
      phone: nextPhone ?? current.phone,
      status: 'wa_disconnected',
      detail: 'WhatsApp worker terputus dari web'
    })
  }

  publishDevice(updated)
  return updated
}

const clearOfflineTimer = (deviceId) => {
  const timer = offlineTimers.get(deviceId)
  if (!timer) return
  clearTimeout(timer)
  offlineTimers.delete(deviceId)
}

const scheduleOffline = (deviceId) => {
  if (offlineTimers.has(deviceId)) return
  const timer = setTimeout(() => {
    offlineTimers.delete(deviceId)
    const session = sessions.get(deviceId)
    if (session?.ready && session.sock?.user) return
    saveDevice(deviceId, { status: DEVICE_STATUS.OFFLINE })
  }, WA_OFFLINE_GRACE_MS)
  offlineTimers.set(deviceId, timer)
}

const clearReconnectTimer = (deviceId) => {
  const timer = reconnectTimers.get(deviceId)
  if (!timer) return
  clearTimeout(timer)
  reconnectTimers.delete(deviceId)
}

const queueReconnect = (deviceId) => {
  if (reconnectTimers.has(deviceId) || connectLocks.has(deviceId)) return
  const attempts = (reconnectAttempts.get(deviceId) ?? 0) + 1
  reconnectAttempts.set(deviceId, attempts)
  if (attempts > WA_MAX_RECONNECT_ATTEMPTS) {
    clearOfflineTimer(deviceId)
    saveDevice(deviceId, { status: DEVICE_STATUS.OFFLINE })
    return
  }
  const timer = setTimeout(() => {
    reconnectTimers.delete(deviceId)
    connectDevice(deviceId).catch((error) => {
      logger.warn({ err: error, deviceId }, 'reconnect perangkat gagal')
    })
  }, WA_RECONNECT_DELAY_MS)
  reconnectTimers.set(deviceId, timer)
}

const disconnectStatusCode = (lastDisconnect) => Number(
  lastDisconnect?.error?.output?.statusCode
  ?? lastDisconnect?.error?.status
  ?? lastDisconnect?.error?.data?.statusCode
  ?? 0
)

const hasPairedCreds = (state, device) => Boolean(
  state?.creds?.registered
  || state?.creds?.me?.id
  || device?.phone
)

const endSocket = (sock) => {
  try {
    sock?.end?.(undefined)
  } catch {
    // socket sudah tertutup
  }
}

const clearSessionFolder = async (dir) => {
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (error) {
    logger.warn({ err: error, dir }, 'gagal hapus folder sesi')
  }
}

export const getSession = (deviceId) => sessions.get(deviceId)

export const listOnlineDevices = (workerId) => db.prepare(`
  SELECT * FROM devices WHERE worker_id = ? AND status = ?
`).all(workerId, DEVICE_STATUS.ONLINE).filter((item) => sessions.get(item.id)?.ready)

export const canUseSuperBrutal = (workerId) => {
  const online = listOnlineDevices(workerId).filter((item) => item.phone)
  if (online.length < SUPER_BRUTAL_DEVICE_COUNT) return false
  const counts = new Map()
  for (const item of online) {
    counts.set(item.phone, (counts.get(item.phone) ?? 0) + 1)
  }
  return [...counts.values()].some((count) => count >= SUPER_BRUTAL_DEVICE_COUNT)
}

export const pickOnlineDevice = (() => {
  const cursor = new Map()
  return (workerId) => {
    const list = listOnlineDevices(workerId)
    if (!list.length) return null
    const next = (cursor.get(workerId) ?? 0) % list.length
    cursor.set(workerId, next + 1)
    return list[next]
  }
})()

export const sendText = async (deviceId, jid, text) => {
  const session = sessions.get(deviceId)
  if (!session?.ready || !session?.sock) {
    throw new Error('Perangkat tidak terhubung')
  }
  await session.sock.sendMessage(jid, { text })
}

const openSocket = async (deviceId) => {
  const device = getDevice(deviceId)
  if (!device) throw new Error('Perangkat tidak ditemukan')

  const existing = sessions.get(deviceId)
  if (existing?.ready && existing.sock?.user) return existing
  if (existing?.sock) {
    existing.replaced = true
    endSocket(existing.sock)
    if (sessions.get(deviceId)?.sock === existing.sock) sessions.delete(deviceId)
  }

  const sessionPath = sessionDirFor(device.worker_id, device.id)
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const paired = hasPairedCreds(state, device)

  if (!paired || device.status !== DEVICE_STATUS.ONLINE) {
    saveDevice(deviceId, { status: DEVICE_STATUS.CONNECTING, sessionDir: sessionPath })
  } else {
    saveDevice(deviceId, { sessionDir: sessionPath })
  }

  const sock = makeWASocket({
    auth: state,
    logger: logger.child({ module: 'baileys', deviceId }),
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000
  })

  const session = { sock, qr: null, pairingCode: null, ready: false, replaced: false }
  sessions.set(deviceId, session)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    try {
      if (session.replaced || sessions.get(deviceId)?.sock !== sock) return

      if (connection === 'open') {
        session.qr = null
        session.pairingCode = null
        session.ready = true
        reconnectAttempts.set(deviceId, 0)
        clearReconnectTimer(deviceId)
        clearOfflineTimer(deviceId)
        const phone = extractPhoneFromJid(sock.user?.id)
        saveDevice(deviceId, { status: DEVICE_STATUS.ONLINE, phone, sessionDir: sessionPath })

        const worker = db.prepare('SELECT referred_by_admin_id FROM users WHERE id = ?').get(device.worker_id)
        writeBlastLog({
          workerId: device.worker_id,
          adminId: worker?.referred_by_admin_id ?? null,
          deviceId: device.id,
          phone: phone ?? device.phone,
          status: 'wa_connected',
          detail: 'WhatsApp worker terhubung ke web'
        })
        return
      }

      if (connection === 'close') {
        session.ready = false
        session.replaced = true
        endSocket(sock)
        if (sessions.get(deviceId)?.sock === sock) sessions.delete(deviceId)

        const statusCode = disconnectStatusCode(lastDisconnect)
        const loggedOut = statusCode === DisconnectReason.loggedOut

        if (loggedOut) {
          reconnectAttempts.delete(deviceId)
          clearReconnectTimer(deviceId)
          clearOfflineTimer(deviceId)
          await clearSessionFolder(sessionPath)
          saveDevice(deviceId, { phone: null, status: DEVICE_STATUS.OFFLINE })
          return
        }

        const latest = getDevice(deviceId)
        if (latest?.status === DEVICE_STATUS.ONLINE) {
          scheduleOffline(deviceId)
        } else if (!paired && latest?.status !== DEVICE_STATUS.CONNECTING) {
          saveDevice(deviceId, { status: DEVICE_STATUS.CONNECTING })
        }
        publishDevice(getDevice(deviceId))
        queueReconnect(deviceId)
        return
      }

      const current = getDevice(deviceId)
      if (qr && current?.pairing_method !== PAIRING_METHOD.CODE && current?.status !== DEVICE_STATUS.ONLINE) {
        session.qr = await QRCode.toDataURL(qr)
        publishDevice(current)
      }
    } catch (error) {
      logger.warn({ err: error, deviceId }, 'connection.update gagal')
    }
  })

  return session
}

export const connectDevice = async (deviceId) => {
  const pending = connectLocks.get(deviceId)
  if (pending) return pending
  const work = openSocket(deviceId).finally(() => {
    if (connectLocks.get(deviceId) === work) connectLocks.delete(deviceId)
  })
  connectLocks.set(deviceId, work)
  return work
}

export const createDevice = async (workerId, { method, phone } = {}) => {
  if (method !== PAIRING_METHOD.QR && method !== PAIRING_METHOD.CODE) {
    throw new Error('Pilih salah satu: QR atau pairing code')
  }
  if (method === PAIRING_METHOD.CODE && !normalizePhone(phone)) {
    throw new Error('Nomor WhatsApp wajib untuk pairing code (format 62...)')
  }

  const result = db.prepare(`
    INSERT INTO devices (worker_id, session_dir, status, pairing_method)
    VALUES (?, ?, ?, ?)
  `).run(workerId, 'pending', DEVICE_STATUS.CONNECTING, method)
  const deviceId = Number(result.lastInsertRowid)
  const sessionPath = sessionDirFor(workerId, deviceId)
  db.prepare('UPDATE devices SET session_dir = ? WHERE id = ?').run(sessionPath, deviceId)
  await connectDevice(deviceId)

  if (method === PAIRING_METHOD.CODE) {
    await requestPairingCode(deviceId, phone)
  } else {
    for (let i = 0; i < 20; i += 1) {
      if (sessions.get(deviceId)?.qr) break
      await sleep(250)
    }
  }
  return getDevice(deviceId)
}

export const requestPairingCode = async (deviceId, rawPhone) => {
  const phone = normalizePhone(rawPhone)
  if (!phone) throw new Error('Nomor WhatsApp tidak valid. Gunakan format 62...')
  let session = sessions.get(deviceId)
  if (!session?.sock) {
    session = await connectDevice(deviceId)
  }
  for (let i = 0; i < 40; i += 1) {
    if (session.sock?.ws?.isOpen) break
    await sleep(250)
  }
  try {
    session.sock.cancelPairingCode?.()
  } catch {
    // tidak ada pairing yang menggantung
  }
  const code = await session.sock.requestPairingCode(phone)
  session.pairingCode = code
  saveDevice(deviceId, { phone, status: DEVICE_STATUS.CONNECTING, pairingMethod: PAIRING_METHOD.CODE })
  publishDevice(getDevice(deviceId))
  return code
}

export const restoreAllSessions = async () => {
  const devices = db.prepare('SELECT * FROM devices').all()
  for (const device of devices) {
    try {
      const sessionPath = sessionDirFor(device.worker_id, device.id)
      const { state } = await useMultiFileAuthState(sessionPath)
      if (!hasPairedCreds(state, device) && !device.pairing_method) {
        saveDevice(device.id, { status: DEVICE_STATUS.OFFLINE })
        continue
      }
      await connectDevice(device.id)
    } catch (error) {
      logger.warn({ err: error, deviceId: device.id }, 'restore sesi gagal')
      saveDevice(device.id, { status: DEVICE_STATUS.OFFLINE })
    }
  }
}

export const monitorPayload = () => {
  const admins = db.prepare(`
    SELECT
      a.id, a.username, a.referral_code, a.balance_cents, a.locked_cents,
      (SELECT COUNT(*) FROM users w WHERE w.referred_by_admin_id = a.id AND w.role = ?) AS worker_count,
      (
        SELECT COUNT(*) FROM devices d
        JOIN users w ON w.id = d.worker_id
        WHERE w.referred_by_admin_id = a.id AND d.status = ?
      ) AS wa_online,
      (
        SELECT COUNT(*) FROM chat_logs c WHERE c.admin_id = a.id
      ) AS total_chats
    FROM users a
    WHERE a.role = ?
  `).all(ROLES.WORKER, DEVICE_STATUS.ONLINE, ROLES.ADMIN)

  const workers = db.prepare(`
    SELECT
      w.id, w.username, w.balance_cents, w.locked_cents, w.referred_by_admin_id,
      a.username AS admin_username,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id AND d.status = ?) AS wa_online,
      (SELECT COUNT(*) FROM devices d WHERE d.worker_id = w.id) AS device_count,
      (SELECT COUNT(*) FROM chat_logs c WHERE c.worker_id = w.id) AS total_chats,
      COALESCE((SELECT is_running FROM blast_jobs b WHERE b.worker_id = w.id), 0) AS is_running
    FROM users w
    LEFT JOIN users a ON a.id = w.referred_by_admin_id
    WHERE w.role = ?
  `).all(DEVICE_STATUS.ONLINE, ROLES.WORKER)

  return { admins, workers }
}
