export const tokenKey = 'wb_token'
export const userKey = 'wb_user'

export const getToken = () => localStorage.getItem(tokenKey)

export const saveSession = ({ token, user }) => {
  localStorage.setItem(tokenKey, token)
  localStorage.setItem(userKey, JSON.stringify(user))
}

export const clearSession = () => {
  localStorage.removeItem(tokenKey)
  localStorage.removeItem(userKey)
}

export const rupiah = (cents) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
}).format(Math.round(Number(cents || 0) / 100))

const TOAST_MS = 4_000
const toastTone = {
  error: 'border-red-700 bg-red-950 text-red-100',
  success: 'border-emerald-700 bg-emerald-950 text-emerald-100',
  info: 'border-slate-700 bg-slate-800 text-slate-100'
}

const toastHost = () => {
  let host = document.getElementById('toast-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'toast-host'
    document.body.appendChild(host)
  }
  host.className = 'pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2'
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;width:20rem;pointer-events:none'
  return host
}

export const formatRupiah = rupiah

export const requireAuth = async () => {
  if (!getToken()) {
    location.href = '/login.html'
    return null
  }
  const { user } = await api('/api/auth/me')
  return user
}

export const logout = () => {
  clearSession()
  location.href = '/login.html'
}

export const notify = (message, type = 'error') => {
  if (!message) return
  const el = document.createElement('div')
  el.className = `pointer-events-auto card ${toastTone[type] ?? toastTone.info}`
  el.textContent = message
  toastHost().appendChild(el)
  setTimeout(() => el.remove(), TOAST_MS)
}

export const api = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const isForm = options.body instanceof FormData
  if (options.body && !isForm && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(path, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && !path.includes('/api/auth/login')) {
    clearSession()
    location.href = '/login.html'
    throw new Error('Sesi berakhir')
  }
  if (!response.ok) {
    throw new Error(data.error || 'Permintaan gagal')
  }
  return data
}
