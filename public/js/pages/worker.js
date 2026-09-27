import { api, notify, requireAuth, logout, formatRupiah } from '../api.js'
import { connectSocket } from '../socket-client.js'

const user = await requireAuth()
if (!user || user.role !== 'worker') window.location.href = '/'

document.getElementById('username').textContent = user.username
document.getElementById('logout-btn').addEventListener('click', logout)

const statsEl = document.getElementById('stats')
const blastStatusEl = document.getElementById('blast-status')
const blastSentEl = document.getElementById('blast-sent')
const blastLogEl = document.getElementById('blast-log')
const startBtn = document.getElementById('start-blast')
const stopBtn = document.getElementById('stop-blast')
const withdrawsList = document.getElementById('withdraws-list')

const socket = connectSocket()

const updateBlastUI = (running) => {
  startBtn.classList.toggle('hidden', running)
  stopBtn.classList.toggle('hidden', !running)
  blastStatusEl.textContent = running ? 'Running' : 'Idle'
  blastStatusEl.className = running ? 'font-medium text-brand-700' : 'font-medium'
}

const loadDashboard = async () => {
  const data = await api('/worker/dashboard')

  statsEl.innerHTML = [
    ['Komisi/Chat', formatRupiah(data.workerRate)],
    ['DB Tersedia', data.availableDb],
    ['WA Online', data.connectedDevices],
    ['Saldo', formatRupiah(data.balance)]
  ].map(([label, value]) => `
    <div class="card">
      <p class="text-sm text-slate-500">${label}</p>
      <p class="text-2xl font-bold">${value}</p>
    </div>
  `).join('')

  blastSentEl.textContent = data.totalSent
  updateBlastUI(data.blastRunning)
}

const loadWithdraws = async () => {
  const withdraws = await api('/worker/withdraws')
  withdrawsList.innerHTML = withdraws.slice(0, 5).map((w) => `
    <div class="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm">
      <span>${formatRupiah(w.amount)}</span>
      <span class="badge ${
        w.status === 'approved' ? 'bg-brand-100 text-brand-700'
        : w.status === 'rejected' ? 'bg-red-100 text-red-700'
        : 'bg-amber-100 text-amber-700'
      }">${w.status}</span>
    </div>
  `).join('') || '<p class="text-sm text-slate-500">Belum ada withdraw</p>'
}

const appendLog = (text) => {
  const line = document.createElement('p')
  line.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${text}`
  blastLogEl.prepend(line)
}

startBtn.addEventListener('click', async () => {
  try {
    const speed = document.getElementById('speed').value
    await api('/worker/blast/start', {
      method: 'POST',
      body: JSON.stringify({ speed })
    })
    updateBlastUI(true)
    appendLog(`Blast dimulai (${speed})`)
  } catch (err) {
    notify(err.message)
  }
})

stopBtn.addEventListener('click', async () => {
  await api('/worker/blast/stop', { method: 'POST' })
  updateBlastUI(false)
  appendLog('Blast dihentikan')
})

document.getElementById('withdraw-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const amount = new FormData(e.target).get('amount')
  await api('/worker/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount: Number(amount) })
  })
  e.target.reset()
  notify('Permintaan withdraw dikirim', 'success')
  loadDashboard()
  loadWithdraws()
})

socket.on('blast:progress', (data) => {
  if (data.totalSent != null) blastSentEl.textContent = data.totalSent

  if (data.status === 'sent') {
    appendLog(`Terkirim ke ${data.phone} (+${formatRupiah(data.earning)})`)
  } else if (data.status === 'failed') {
    appendLog(`Gagal ke ${data.phone}: ${data.error}`)
  } else if (data.status === 'completed' || data.status === 'stopped') {
    updateBlastUI(false)
    appendLog(`Blast ${data.status}`)
    loadDashboard()
  }
})

await loadDashboard()
await loadWithdraws()

setInterval(loadDashboard, 15_000)
