export const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return null

  let phone = digits
  if (phone.startsWith('0')) {
    phone = `62${phone.slice(1)}`
  } else if (phone.startsWith('8')) {
    phone = `62${phone}`
  }

  if (phone.length < 10 || phone.length > 15) return null
  if (!phone.startsWith('62')) return null
  return phone
}

export const toWhatsAppJid = (phone) => `${phone}@s.whatsapp.net`

export const extractPhoneFromJid = (jid) => {
  if (!jid) return null
  const [user] = String(jid).split('@')
  const [phone] = user.split(':')
  return normalizePhone(phone)
}
