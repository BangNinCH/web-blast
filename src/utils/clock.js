export const APP_TIMEZONE = 'Asia/Jakarta'

const pad = (value) => String(value).padStart(2, '0')

export const nowInAppTz = (date = new Date()) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((item) => [item.type, item.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`
  }
}

export const timeToMinutes = (hhmm) => {
  const match = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export const formatHHmm = (hhmm) => {
  const minutes = timeToMinutes(hhmm)
  if (minutes == null) return null
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export const isInScheduleWindow = (startHHmm, stopHHmm, nowHHmm) => {
  const start = timeToMinutes(startHHmm)
  const stop = timeToMinutes(stopHHmm)
  const now = timeToMinutes(nowHHmm)
  if (start == null || stop == null || now == null) return false
  if (start === stop) return true
  if (start < stop) return now >= start && now < stop
  return now >= start || now < stop
}
