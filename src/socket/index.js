import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { db, publicUser } from '../db/index.js'
import { logger } from '../logger.js'

let ioRef = null

export const setIo = (io) => {
  ioRef = io
}

export const getIo = () => ioRef

export const emitToUser = (userId, event, payload) => {
  ioRef?.to(`user:${userId}`).emit(event, payload)
}

export const emitToRole = (role, event, payload) => {
  ioRef?.to(`role:${role}`).emit(event, payload)
}

export const emitDeviceStatus = (device) => {
  emitToUser(device.worker_id, 'device:status', device)
  const worker = db.prepare('SELECT referred_by_admin_id FROM users WHERE id = ?').get(device.worker_id)
  if (worker?.referred_by_admin_id) {
    emitToUser(worker.referred_by_admin_id, 'device:status', device)
  }
  emitToRole('super_admin', 'device:status', device)
}

export const emitBlastStats = (payload) => {
  emitToUser(payload.workerId, 'blast:stats', payload)
  if (payload.adminId) emitToUser(payload.adminId, 'blast:stats', payload)
  emitToRole('super_admin', 'blast:stats', payload)
}

export const emitNotification = (userId, item) => {
  emitToUser(userId, 'notification:new', item)
}

export const emitBlastLog = (row) => {
  emitToUser(row.worker_id, 'blast:log', row)
  if (row.admin_id) emitToUser(row.admin_id, 'blast:log', row)
  emitToRole('super_admin', 'blast:log', row)
}

export const attachSocket = (io) => {
  setIo(io)

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) {
        next(new Error('Wajib login'))
        return
      }
      const payload = jwt.verify(token, config.jwtSecret)
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id)
      if (!user) {
        next(new Error('Akun tidak aktif'))
        return
      }
      socket.user = publicUser(user)
      next()
    } catch (error) {
      logger.warn({ err: error }, 'socket auth gagal')
      next(new Error('Sesi tidak valid'))
    }
  })

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`)
    socket.join(`role:${socket.user.role}`)
  })
}
