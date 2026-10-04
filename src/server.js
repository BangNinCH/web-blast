import http from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import { config } from './config.js'
import { logger } from './logger.js'
import { authRouter } from './routes/auth.js'
import { superAdminRouter } from './routes/super-admin.js'
import { adminRouter } from './routes/admin.js'
import { workerRouter } from './routes/worker.js'
import { systemRouter } from './routes/system.js'
import { resetRunningJobs } from './services/blast-engine.js'
import { startBlastSchedule } from './services/blast-schedule.js'
import { restoreAllSessions } from './services/wa-manager.js'
import { attachSocket } from './socket/index.js'

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: false }
})

attachSocket(io)

app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(config.publicDir))

app.use('/api/auth', authRouter)
app.use('/api/super', superAdminRouter)
app.use('/api/admin', adminRouter)
app.use('/api/worker', workerRouter)
app.use('/api/system', systemRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' })
})

// Export Express app untuk Vercel
export default app

const isVercel = Boolean(process.env.VERCEL)

const start = async () => {
  // Background process hanya dijalankan pada server lokal/VPS.
  // Untuk testing Vercel, jangan restore WhatsApp session
  // dan jangan menjalankan scheduler/background blast.
  if (!isVercel) {
    resetRunningJobs()

    try {
      await restoreAllSessions()
    } catch (error) {
      logger.warn({ err: error }, 'restore sesi WhatsApp gagal')
    }

    startBlastSchedule()
  }

  server.listen(config.port, () => {
    logger.info({ port: config.port }, 'web blast berjalan')
  })
}

// npm start lokal tetap bekerja seperti sebelumnya.
// Vercel menggunakan export default app di atas.
if (!isVercel) {
  start().catch((error) => {
    logger.error({ err: error }, 'gagal start server')
    process.exit(1)
  })
}