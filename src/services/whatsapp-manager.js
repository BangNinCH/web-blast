import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@rexxhayanasi/elaina-baileys'
import QRCode from 'qrcode'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { getDb } from '../db/database.js'
import { DEVICE_STATUS } from '../config/constants.js'

class WhatsAppManager {
  constructor() {
    this.sockets = new Map()
    this.pendingAuth = new Map()
    this.io = null
  }

  setIo(io) {
    this.io = io
  }

  sessionPath(workerId, deviceId) {
    return path.join(process.cwd(), 'data', 'sessions', String(workerId), String(deviceId))
  }

  emitToWorker(workerId, event, data) {
    this.io?.to(`worker:${workerId}`).emit(event, data)
  }

  async createDevice(workerId, { label, method, phoneNumber }) {
    const db = getDb()
    const sessionDir = path.join(process.cwd(), 'data', 'sessions', String(workerId), 'pending')

    const result = db.prepare(`
      INSERT INTO whatsapp_devices (worker_id, label, session_path, status)
      VALUES (?, ?, ?, ?)
    `).run(workerId, label, sessionDir, DEVICE_STATUS.CONNECTING)

    const deviceId = result.lastInsertRowid
    const finalSessionPath = this.sessionPath(workerId, deviceId)

    await mkdir(finalSessionPath, { recursive: true })
    db.prepare('UPDATE whatsapp_devices SET session_path = ? WHERE id = ?').run(finalSessionPath, deviceId)

    await this.connectDevice(workerId, deviceId, { method, phoneNumber })

    return db.prepare(`
      SELECT id, label, phone_number, status, created_at FROM whatsapp_devices WHERE id = ?
    `).get(deviceId)
  }

  async connectDevice(workerId, deviceId, { method = 'qr', phoneNumber } = {}) {
    const db = getDb()
    const device = db.prepare('SELECT * FROM whatsapp_devices WHERE id = ? AND worker_id = ?').get(deviceId, workerId)

    if (!device) throw new Error('Perangkat tidak ditemukan')

    const authKey = `${workerId}:${deviceId}`
    if (this.sockets.has(authKey)) {
      return this.sockets.get(authKey)
    }

    db.prepare('UPDATE whatsapp_devices SET status = ? WHERE id = ?').run(DEVICE_STATUS.CONNECTING, deviceId)

    const { state, saveCreds } = await useMultiFileAuthState(device.session_path)

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000
    })

    this.sockets.set(authKey, sock)
    this.pendingAuth.set(authKey, { method, phoneNumber, pairingRequested: false })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update
      const pending = this.pendingAuth.get(authKey)

      if (qr && method === 'qr') {
        const qrDataUrl = await QRCode.toDataURL(qr)
        this.emitToWorker(workerId, 'wa:qr', { deviceId, qr: qrDataUrl })
      }

      if (qr && method === 'pairing' && pending && !pending.pairingRequested && !state.creds.registered) {
        pending.pairingRequested = true
        try {
          const normalizedPhone = phoneNumber.replace(/\D/g, '')
          const code = await sock.requestPairingCode(normalizedPhone)
          this.emitToWorker(workerId, 'wa:pairing-code', { deviceId, code })
        } catch (err) {
          this.emitToWorker(workerId, 'wa:error', { deviceId, error: err.message })
        }
      }

      if (connection === 'open') {
        const phone = sock.user?.id?.split(':')[0] ?? sock.user?.id?.split('@')[0]
        db.prepare(`
          UPDATE whatsapp_devices
          SET status = ?, phone_number = ?, last_connected_at = datetime('now')
          WHERE id = ?
        `).run(DEVICE_STATUS.CONNECTED, phone, deviceId)

        this.emitToWorker(workerId, 'wa:connected', { deviceId, phoneNumber: phone })
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        db.prepare('UPDATE whatsapp_devices SET status = ? WHERE id = ?').run(DEVICE_STATUS.DISCONNECTED, deviceId)
        this.emitToWorker(workerId, 'wa:disconnected', { deviceId, shouldReconnect })

        this.sockets.delete(authKey)
        this.pendingAuth.delete(authKey)

        if (shouldReconnect) {
          setTimeout(() => {
            this.connectDevice(workerId, deviceId, { method: 'qr' }).catch(() => {})
          }, 5_000)
        }
      }
    })

    return sock
  }

  async restoreSessions() {
    const devices = getDb().prepare(`
      SELECT id, worker_id, session_path FROM whatsapp_devices
    `).all()

    for (const device of devices) {
      try {
        await this.connectDevice(device.worker_id, device.id)
      } catch {
        getDb().prepare('UPDATE whatsapp_devices SET status = ? WHERE id = ?')
          .run(DEVICE_STATUS.DISCONNECTED, device.id)
      }
    }
  }

  getConnectedSockets(workerId) {
    const entries = [...this.sockets.entries()]
    return entries
      .filter(([key]) => key.startsWith(`${workerId}:`))
      .map(([, sock]) => sock)
      .filter((sock) => sock.user)
  }

  async sendMessage(workerId, jid, text) {
    const sockets = this.getConnectedSockets(workerId)
    if (sockets.length === 0) throw new Error('Tidak ada perangkat terhubung')

    const sock = sockets[Math.floor(Math.random() * sockets.length)]
    const formattedJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`

    return sock.sendMessage(formattedJid, { text })
  }

  async removeDevice(workerId, deviceId) {
    const authKey = `${workerId}:${deviceId}`
    const sock = this.sockets.get(authKey)

    if (sock) {
      try {
        await sock.logout()
      } catch {
        sock.end(undefined)
      }
      this.sockets.delete(authKey)
      this.pendingAuth.delete(authKey)
    }

    getDb().prepare('DELETE FROM whatsapp_devices WHERE id = ? AND worker_id = ?').run(deviceId, workerId)
  }
}

export const whatsappManager = new WhatsAppManager()
