import { api, notify, requireAuth, logout, formatRupiah } from '../api.js'

const user = await requireAuth()
if (!user || user.role !== 'admin') window.location.href = '/'

document.getElementById('username').textContent = user.username
document.getElementById('logout-btn').addEventListener('click', logout)

const statsEl = document.getElementById('stats')
const workersTable = document.getElementById('workers-table')
const withdrawsList = document.getElementById('withdraws-list')
const referralCodeEl = document.getElementById('referral-code')

const loadDashboard = async () => {
  const stats = await api('/admin/dashboard')
  referralCodeEl.textContent = stats.referralCode

  statsEl.innerHTML = [
    ['Worker', stats.workerCount],
    ['WA Online', stats.onlineDevices],
    ['Total Chat', stats.totalChats],
    ['Saldo', formatRupiah(stats.balance)]
  ].map(([label, value]) => `
    <div class="card">
      <p class="text-sm text-slate-500">${label}</p>
      <p class="text-2xl font-bold">${value}</p>
    </div>
  `).join('')
}

const loadWorkers = async () => {
  const workers = await api('/admin/workers')
  workersTable.innerHTML = workers.map((w) => `
    <tr class="border-b border-slate-100">
      <td class="py-2 font-medium">${w.username}</td>
      <td>${w.online_devices}</td>
      <td>${w.total_chats}</td>
      <td>${formatRupiah(w.commission_generated)}</td>
      <td>
        <span class="badge ${w.is_active ? 'bg-brand-100 text-brand-700' : 'bg-red-100 text-red-700'}">
          ${w.is_active ? 'Aktif' : 'Nonaktif'}
        </span>
      </td>
    </tr>
  `).join('')
}

const loadWithdraws = async () => {
  const withdraws = await api('/admin/withdraws')
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

document.getElementById('copy-referral').addEventListener('click', () => {
  navigator.clipboard.writeText(referralCodeEl.textContent)
  notify('Kode referral disalin', 'success')
})

document.getElementById('withdraw-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const amount = new FormData(e.target).get('amount')
  await api('/admin/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount: Number(amount) })
  })
  e.target.reset()
  notify('Permintaan withdraw dikirim', 'success')
  loadDashboard()
  loadWithdraws()
})

await loadDashboard()
await loadWorkers()
await loadWithdraws()

setInterval(() => {
  loadDashboard()
  loadWorkers()
}, 15_000)
