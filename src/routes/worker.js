import { Router } from 'express'
import { db, getSettings, publicUser } from '../db/index.js'
import { authRequired, requireWorker } from '../middleware/auth.js'
import { getWorkerBlastState, saveSpeed, startBlast, stopBlast } from '../services/blast-engine.js'
import { listBlastLogs } from '../services/blast-logs.js'
import { getReferralNetwork } from '../services/referral-network.js'
import { requestWithdraw, saveBank } from '../services/wallet.js'
import {
  canUseSuperBrutal,
  createDevice,
  getSession,
  listOnlineDevices,
  requestPairingCode
} from '../services/wa-manager.js'
import { centsFromRupiah } from '../utils/money.js'
import { writeAuditLog } from '../services/audit-log.js'
import { createNotification } from '../services/notifications.js'

export const workerRouter = Router()
workerRouter.use(authRequired, requireWorker)

workerRouter.get('/dashboard', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    const devices = db.prepare('SELECT * FROM devices WHERE worker_id = ? ORDER BY id DESC').all(req.user.id)
    res.json({
      user: publicUser(user),
      settings: getSettings(),
      blast: getWorkerBlastState(req.user.id),
      superBrutalReady: canUseSuperBrutal(req.user.id),
      devices,
      logs: listBlastLogs({ workerId: req.user.id })
    })
  } catch {
    res.status(500).json({ error: 'Gagal memuat dashboard' })
  }
})

workerRouter.post('/blast/start', (req, res) => {
  try {
    const speedMode = req.body?.speedMode ? String(req.body.speedMode) : undefined
    const blast = startBlast(req.user.id, speedMode)
    res.json({ blast })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal start blast' })
  }
})

workerRouter.post('/blast/stop', (req, res) => {
  try {
    const blast = stopBlast(req.user.id)
    res.json({ blast })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal stop blast' })
  }
})

workerRouter.put('/blast/speed', (req, res) => {
  try {
    const blast = saveSpeed(req.user.id, String(req.body?.speedMode || 'santai'))
    res.json({ blast })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal menyimpan kecepatan' })
  }
})

workerRouter.get('/devices', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  const devices = listOnlineDevices(req.user.id)
  res.json({
    devices,
    superBrutalReady: canUseSuperBrutal(req.user.id),
    messageLimit: user.message_limit ?? 0
  })
})

workerRouter.put('/message-limit', (req, res) => {
  try {
    const limit = Math.max(0, Number(req.body?.messageLimit) || 0)
    db.prepare('UPDATE users SET message_limit = ? WHERE id = ?').run(limit, req.user.id)
    res.json({ messageLimit: limit })
  } catch {
    res.status(500).json({ error: 'Gagal menyimpan limit pesan' })
  }
})

workerRouter.post('/devices/:id/pairing-code', async (req, res) => {
  try {
    const device = db.prepare('SELECT * FROM devices WHERE id = ? AND worker_id = ?')
      .get(Number(req.params.id), req.user.id)
    if (!device) {
      res.status(404).json({ error: 'Perangkat tidak ditemukan' })
      return
    }
    const code = await requestPairingCode(device.id, req.body?.phone)
    res.json({ pairingCode: code })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal meminta kode pairing' })
  }
})

workerRouter.post('/devices', async (req, res) => {
  try {
    const device = await createDevice(req.user.id, {
      method: req.body?.method,
      phone: req.body?.phone
    })
    const session = getSession(device.id)
    res.status(201).json({
      device: {
        ...device,
        qr: session?.qr ?? null,
        pairingCode: session?.pairingCode ?? null
      }
    })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal menambah perangkat' })
  }
})

workerRouter.get('/blast-history', (req, res) => {
  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'start') AS starts,
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'sent') AS success,
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'failed') AS failed,
      (SELECT COUNT(*) FROM blast_logs WHERE worker_id = ? AND status = 'stop') AS stops
  `).get(req.user.id, req.user.id, req.user.id, req.user.id)
  const logs = listBlastLogs({ workerId: req.user.id, limit: 200 })
  res.json({ summary, logs })
})

workerRouter.get('/network', (req, res) => {
  res.json(getReferralNetwork(req.user))
})

workerRouter.put('/bank', (req, res) => {
  try {
    const { bankName, bankAccount, bankHolder } = req.body ?? {}
    if (!bankName || !bankAccount || !bankHolder) {
      res.status(400).json({ error: 'Data rekening wajib lengkap' })
      return
    }
    const bank = saveBank(req.user.id, { bankName, bankAccount, bankHolder })
    writeAuditLog({ actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role, action: 'update_bank', entityType: 'user', entityId: req.user.id, detail: 'Data rekening diperbarui' })
    res.json({ bank })
  } catch {
    res.status(500).json({ error: 'Gagal menyimpan rekening' })
  }
})

workerRouter.get('/withdrawals', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC
  `).all(req.user.id)
  res.json({ withdrawals: items })
})

workerRouter.post('/withdrawals', (req, res) => {
  try {
    const amount = centsFromRupiah(req.body?.amountRupiah)
    if (!amount || amount <= 0) {
      res.status(400).json({ error: 'Nominal withdraw tidak valid' })
      return
    }
    const withdrawal = requestWithdraw(req.user.id, amount)
    writeAuditLog({ actorId: req.user.id, actorUsername: req.user.username, actorRole: req.user.role, action: 'withdraw_request', entityType: 'withdrawal', entityId: withdrawal.id, detail: `Mengajukan withdraw sebesar ${amount} cents` })
    createNotification({ userId: req.user.id, type: 'withdraw', title: 'Withdraw diajukan', message: `Permintaan withdraw #${withdrawal.id} berhasil diajukan.` })
    res.status(201).json({ withdrawal })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal mengajukan withdraw' })
  }
})
