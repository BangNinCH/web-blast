import { api, notify, requireAuth, logout } from '../api.js'
import { connectSocket } from '../socket-client.js'

const user = await requireAuth()
if (!user || user.role !== 'worker') window.location.href = '/'

document.getElementById('logout-btn').addEventListener('click', logout)

const methodSelect = document.getElementById('method')
const phoneField = document.getElementById('phone-field')
const pairingPanel = document.getElementById('pairing-panel')
const qrContainer = document.getElementById('qr-container')
const pairingCodeContainer = document.getElementById('pairing-code-container')
const devicesList = document.getElementById('devices-list')

const socket = connectSocket()

methodSelect.addEventListener('change', () => {
  phoneField.classList.toggle('hidden', methodSelect.value !== 'pairing')
})

const statusBadge = (status) => {
  const map = {
    connected: 'bg-brand-100 text-brand-700',
    connecting: 'bg-amber-100 text-amber-700',
    disconnected: 'bg-red-100 text-red-700'
  }
  return `<span class="badge ${map[status] ?? 'bg-slate-100 text-slate-600'}">${status}</span>`
}

const loadDevices = async () => {
  const payload = await api('/worker/devices')
  const devices = (Array.isArray(payload) ? payload : payload?.devices ?? [])
    .filter((d) => d.status === 'online' || d.status === 'connected')
  devicesList.innerHTML = devices.length ? devices.map((d) => `
    <div class="flex items-center justify-between rounded-lg border border-slate-200 p-4">
      <div>
        <p class="font-medium">${d.label ?? 'Perangkat'}</p>
        <p class="text-sm text-slate-500">${d.phone_number ?? 'Belum terhubung'}</p>
        ${statusBadge(d.status)}
      </div>
      <button class="btn-danger text-xs" data-id="${d.id}">Hapus</button>
    </div>
  `).join('') : '<p class="text-sm text-slate-500">Belum ada perangkat. Tambahkan untuk mulai blast.</p>'

  devicesList.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus perangkat ini? Session akan dihapus.')) return
      await api(`/worker/devices/${btn.dataset.id}`, { method: 'DELETE' })
      loadDevices()
    })
  })
}

document.getElementById('add-device-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const formData = new FormData(e.target)

  pairingPanel.classList.remove('hidden')
  qrContainer.classList.add('hidden')
  pairingCodeContainer.classList.add('hidden')

  await api('/worker/devices', {
    method: 'POST',
    body: JSON.stringify({
      label: formData.get('label'),
      method: formData.get('method'),
      phoneNumber: formData.get('phoneNumber')
    })
  })

  loadDevices()
})

socket.on('wa:qr', ({ qr }) => {
  pairingPanel.classList.remove('hidden')
  qrContainer.classList.remove('hidden')
  pairingCodeContainer.classList.add('hidden')
  document.getElementById('qr-image').src = qr
})

socket.on('wa:pairing-code', ({ code }) => {
  pairingPanel.classList.remove('hidden')
  pairingCodeContainer.classList.remove('hidden')
  qrContainer.classList.add('hidden')
  document.getElementById('pairing-code').textContent = code
})

socket.on('wa:connected', ({ phoneNumber }) => {
  pairingPanel.classList.add('hidden')
  notify(`WhatsApp terhubung: ${phoneNumber}`, 'success')
  loadDevices()
})

socket.on('wa:disconnected', () => {
  loadDevices()
})

socket.on('wa:error', ({ error }) => {
  notify(`Error pairing: ${error}`, 'error')
})

await loadDevices()
