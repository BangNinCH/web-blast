import { api, notify, requireAuth, logout, formatRupiah } from '../api.js'

const user = await requireAuth()
if (!user || user.role !== 'super_admin') window.location.href = '/'

document.getElementById('username').textContent = user.username
document.getElementById('logout-btn').addEventListener('click', logout)

const statsEl = document.getElementById('stats')
const adminsTable = document.getElementById('admins-table')
const workersTable = document.getElementById('workers-table')
const databasesList = document.getElementById('databases-list')
const withdrawsList = document.getElementById('withdraws-list')
const settingsForm = document.getElementById('settings-form')

const loadDashboard = async () => {
  const stats = await api('/super-admin/dashboard')
  statsEl.innerHTML = [
    ['Admin', stats.admins],
    ['Worker', stats.workers],
    ['DB Aktif', stats.activeDatabases],
    ['Withdraw Pending', stats.pendingWithdraws],
    ['Total Chat', stats.totalChats]
  ].map(([label, value]) => `
    <div class="card">
      <p class="text-sm text-slate-500">${label}</p>
      <p class="text-2xl font-bold text-slate-900">${value}</p>
    </div>
  `).join('')
}

const loadAdmins = async () => {
  const admins = await api('/super-admin/admins')
  adminsTable.innerHTML = admins.map((a) => `
    <tr class="border-b border-slate-100">
      <td class="py-2 font-medium">${a.username}</td>
      <td><code class="text-xs">${a.referral_code}</code></td>
      <td>${a.worker_count}</td>
      <td>${a.total_chats}</td>
    </tr>
  `).join('')
}

const loadWorkers = async () => {
  const workers = await api('/super-admin/workers')
  workersTable.innerHTML = workers.map((w) => `
    <tr class="border-b border-slate-100">
      <td class="py-2">${w.username}</td>
      <td>${w.admin_username ?? '-'}</td>
      <td>${w.online_devices}</td>
      <td>${w.total_chats}</td>
      <td>${formatRupiah(w.balance)}</td>
    </tr>
  `).join('')
}

const loadDatabases = async () => {
  const dbs = await api('/super-admin/databases')
  databasesList.innerHTML = dbs.map((db) => `
    <div class="flex items-center justify-between rounded-lg border border-slate-200 p-3">
      <div>
        <p class="font-medium">${db.name}</p>
        <p class="text-xs text-slate-500">${db.pending_count} pending · ${db.sent_count} terkirim · ${db.total_numbers} total</p>
      </div>
      <button
        class="${db.status === 'active' ? 'btn-danger' : 'btn-primary'} text-xs"
        data-id="${db.id}"
        data-status="${db.status === 'active' ? 'inactive' : 'active'}"
      >
        ${db.status === 'active' ? 'Stop' : 'Start'}
      </button>
    </div>
  `).join('')

  databasesList.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/super-admin/databases/${btn.dataset.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: btn.dataset.status })
      })
      loadDatabases()
    })
  })
}

const loadWithdraws = async () => {
  const withdraws = await api('/super-admin/withdraws')
  const pending = withdraws.filter((w) => w.status === 'pending')

  withdrawsList.innerHTML = pending.length ? pending.map((w) => `
    <div class="rounded-lg border border-slate-200 p-3">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-medium">${w.username} <span class="badge bg-slate-100 text-slate-600">${w.role}</span></p>
          <p class="text-sm text-slate-500">${formatRupiah(w.amount)} · ${new Date(w.created_at).toLocaleString('id-ID')}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-primary text-xs" data-action="approve" data-id="${w.id}">Accept</button>
          <button class="btn-danger text-xs" data-action="reject" data-id="${w.id}">Reject</button>
        </div>
      </div>
    </div>
  `).join('') : '<p class="text-sm text-slate-500">Tidak ada permintaan pending</p>'

  withdrawsList.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/super-admin/withdraws/${btn.dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: btn.dataset.action })
      })
      loadWithdraws()
      loadDashboard()
    })
  })
}

const loadSettings = async () => {
  const settings = await api('/super-admin/settings')
  for (const [key, value] of Object.entries(settings)) {
    const input = settingsForm.elements[key]
    if (input) input.value = value
  }
}

document.getElementById('add-admin-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const formData = new FormData(e.target)
  const result = await api('/super-admin/admins', {
    method: 'POST',
    body: JSON.stringify({
      username: formData.get('username'),
      password: formData.get('password')
    })
  })
  notify(`Admin dibuat. Kode referral: ${result.referralCode}`, 'success')
  e.target.reset()
  loadAdmins()
})

document.getElementById('upload-db-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const formData = new FormData(e.target)
  await api('/super-admin/databases', { method: 'POST', body: formData })
  e.target.reset()
  loadDatabases()
  loadDashboard()
})

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const formData = new FormData(e.target)
  await api('/super-admin/settings', {
    method: 'PUT',
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  })
  notify('Pengaturan disimpan', 'success')
})

await loadDashboard()
await loadAdmins()
await loadWorkers()
await loadDatabases()
await loadWithdraws()
await loadSettings()

setInterval(() => {
  loadDashboard()
  loadWorkers()
  loadWithdraws()
}, 15_000)
