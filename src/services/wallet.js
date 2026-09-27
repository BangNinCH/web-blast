import { WITHDRAW_STATUS } from '../constants.js'
import { db, getSettings } from '../db/index.js'

export const creditChat = ({ workerId, adminId, deviceId, targetId, phone }) => {
  const settings = getSettings()
  const sender = db.prepare('SELECT referred_by_worker_id FROM users WHERE id = ?').get(workerId)
  const referrerWorkerId = sender?.referred_by_worker_id ?? null
  const workerAmount = settings.worker_rate_cents
  const adminAmount = adminId ? settings.admin_commission_cents : 0
  const referralAmount = referrerWorkerId ? (settings.worker_referral_cents || 0) : 0

  const apply = db.transaction(() => {
    db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?')
      .run(workerAmount, workerId)
    if (adminId && adminAmount > 0) {
      db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?')
        .run(adminAmount, adminId)
    }
    if (referrerWorkerId && referralAmount > 0) {
      db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?')
        .run(referralAmount, referrerWorkerId)
    }
    db.prepare(`
      INSERT INTO chat_logs (
        worker_id, admin_id, device_id, target_id, phone,
        worker_amount_cents, admin_amount_cents, referrer_worker_id, worker_referral_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workerId,
      adminId ?? null,
      deviceId,
      targetId,
      phone,
      workerAmount,
      adminAmount,
      referrerWorkerId,
      referralAmount
    )
  })

  apply()
  return { workerAmount, adminAmount, referralAmount, referrerWorkerId }
}

export const requestWithdraw = (userId, amountCents) => {
  const settings = getSettings()
  if (amountCents < settings.min_withdraw_cents) {
    throw new Error(`Minimum withdraw ${settings.min_withdraw_cents / 100} rupiah`)
  }

  const run = db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) throw new Error('User tidak ditemukan')
    if (!user.bank_name || !user.bank_account || !user.bank_holder) {
      throw new Error('Lengkapi data rekening terlebih dahulu')
    }
    if (user.balance_cents < amountCents) {
      throw new Error('Saldo tidak mencukupi')
    }
    db.prepare(`
      UPDATE users
      SET balance_cents = balance_cents - ?, locked_cents = locked_cents + ?
      WHERE id = ?
    `).run(amountCents, amountCents, userId)
    const result = db.prepare(`
      INSERT INTO withdrawals (user_id, amount_cents, status)
      VALUES (?, ?, ?)
    `).run(userId, amountCents, WITHDRAW_STATUS.PENDING)
    return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(result.lastInsertRowid)
  })

  return run()
}

export const reviewWithdraw = (withdrawalId, accept) => {
  const run = db.transaction(() => {
    const item = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId)
    if (!item) throw new Error('Pengajuan tidak ditemukan')
    if (item.status !== WITHDRAW_STATUS.PENDING) {
      throw new Error('Pengajuan sudah diproses')
    }

    if (accept) {
      db.prepare(`
        UPDATE users SET locked_cents = locked_cents - ? WHERE id = ?
      `).run(item.amount_cents, item.user_id)
      db.prepare(`
        UPDATE withdrawals SET status = ?, reviewed_at = datetime('now') WHERE id = ?
      `).run(WITHDRAW_STATUS.ACCEPTED, withdrawalId)
    } else {
      db.prepare(`
        UPDATE users
        SET locked_cents = locked_cents - ?, balance_cents = balance_cents + ?
        WHERE id = ?
      `).run(item.amount_cents, item.amount_cents, item.user_id)
      db.prepare(`
        UPDATE withdrawals SET status = ?, reviewed_at = datetime('now') WHERE id = ?
      `).run(WITHDRAW_STATUS.REJECTED, withdrawalId)
    }

    return db.prepare(`
      SELECT w.*, u.username, u.role, u.bank_name, u.bank_account, u.bank_holder
      FROM withdrawals w
      JOIN users u ON u.id = w.user_id
      WHERE w.id = ?
    `).get(withdrawalId)
  })

  return run()
}

export const saveBank = (userId, { bankName, bankAccount, bankHolder }) => {
  db.prepare(`
    UPDATE users
    SET bank_name = ?, bank_account = ?, bank_holder = ?
    WHERE id = ?
  `).run(bankName, bankAccount, bankHolder, userId)
  return db.prepare(`
    SELECT bank_name, bank_account, bank_holder FROM users WHERE id = ?
  `).get(userId)
}
