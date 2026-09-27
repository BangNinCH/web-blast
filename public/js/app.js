import { api, clearSession, getToken, notify, rupiah } from './api.js'

const view = document.getElementById('view')
const nav = document.getElementById('nav')
const roleLabel = document.getElementById('role-label')
const userLabel = document.getElementById('user-label')

let currentUser = null
let page = 'dashboard'
let pollTimer = null
let socket = null
let pairingDeviceId = null
let monitorStatsRefreshTimer = null
const DEVICE_POLL_MS = 8_000

const menus = {
  super_admin: [
    ['dashboard', 'Dashboard'],
    ['db-monitor', 'Pantau DB'],
    ['dbs', 'Database'],
    ['admins', 'Admin'],
    ['workers', 'Worker'],
    ['audit', 'Audit Log'],
    ['health', 'System Health'],
    ['settings', 'Pengaturan'],
    ['withdrawals', 'Withdraw']
  ],
  admin: [
    ['dashboard', 'Dashboard'],
    ['monitor-jobs', 'Monitor Jobs'],
    ['workers', 'Worker'],
    ['network', 'Jaringan'],
    ['activity', 'Activity'],
    ['withdraw', 'Withdraw']
  ],
  worker: [
    ['dashboard', 'Dashboard'],
    ['devices', 'Perangkat'],
    ['network', 'Jaringan'],
    ['blast-history', 'Riwayat Blast'],
    ['withdraw', 'Withdraw']
  ]
}

const roleText = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  worker: 'Worker'
}

const statusBadge = (text, ok) => {
  const status = String(text || '')
  const online = ok === true || status === 'online' || status === 'connected'
  const connecting = status === 'connecting'
  const tone = online ? 'success' : connecting ? 'warning' : 'danger'
  return `<span data-status class="wb-badge wb-badge-${tone}">${status || text}</span>`
}

const card = (label, value) => `
  <div class="card wb-stat-card">
    <div class="wb-stat-top"><span class="wb-stat-dot"></span><span class="wb-stat-label">${label}</span></div>
    <p class="wb-stat-value">${value}</p>
  </div>
`

const payableCard = (label, value, tone = 'red', note = '') => `
  <article class="card wb-payable-card wb-payable-${tone}">
    <div class="wb-payable-glow"></div>
    <div class="wb-payable-top">
      <div class="wb-payable-icon">${tone === 'yellow' ? '◇' : '◈'}</div>
      <div class="wb-payable-label">${label}</div>
      <span class="wb-payable-tag">UNPAID</span>
    </div>
    <div class="wb-payable-value">${value}</div>
    <div class="wb-payable-note">${note}</div>
  </article>
`

const table = (headers, rows) => `
  <div class="wb-table-wrap overflow-x-auto">
    <table class="wb-table min-w-full text-left text-sm">
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
`

const logRow = (item) => `
  <div class="wb-log-row">
    <div class="wb-log-meta">
      <span>${item.created_at || ''}</span>
      ${item.worker_username ? `<span class="wb-log-worker">${item.worker_username}</span>` : ''}
    </div>
    <div class="wb-log-main">
      <span class="wb-log-status">${String(item.status || 'log').toUpperCase()}</span>
      ${item.phone ? `<span class="font-mono">${item.phone}</span>` : ''}
      ${item.detail ? `<span class="wb-log-detail">${item.detail}</span>` : ''}
    </div>
  </div>
`

const liveLogsCard = (logs, title) => `
  <div class="card wb-live-card mt-4">
    <div class="wb-section-bar">
      <div><div class="wb-page-kicker">LIVE STREAM</div><h2 class="mt-1 font-black">${title}</h2></div>
      <span class="wb-live-chip">● LIVE</span>
    </div>
    <div id="live-logs" class="wb-live-log-list max-h-80 overflow-y-auto">
      ${(logs || []).map(logRow).join('') || '<p class="wb-empty">Belum ada aktivitas...</p>'}
    </div>
  </div>
`

const prependLiveLog = (item) => {
  const box = document.getElementById('live-logs')
  if (!box) return
  const empty = box.querySelector('p')
  if (empty) empty.remove()
  box.insertAdjacentHTML('afterbegin', logRow(item))
}

const referralLink = (code) => `${location.origin}/register.html?ref=${encodeURIComponent(code || '')}`

const setError = (message) => notify(message, 'error')

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

let notifications = []

const notificationIcon = (type) => ({
  success: '✓', warning: '!', error: '×', withdraw: '◇', info: '•'
}[type] || '•')

const renderNotifications = () => {
  const list = document.getElementById('notification-list')
  const count = document.getElementById('notification-count')
  if (!list || !count) return
  const unread = notifications.filter((item) => !item.read_at).length
  count.textContent = String(unread)
  count.classList.toggle('hidden', unread === 0)
  list.innerHTML = notifications.map((item) => `
    <button type="button" class="wb-notification-item ${item.read_at ? '' : 'is-unread'}" data-notification="${item.id}">
      <span class="wb-notification-icon">${notificationIcon(item.type)}</span>
      <span class="min-w-0 text-left">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.message)}</span>
        <small>${escapeHtml(item.created_at)}</small>
      </span>
    </button>
  `).join('') || '<div class="wb-notification-empty">Belum ada notifikasi.</div>'
  list.querySelectorAll('[data-notification]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.notification)
      try {
        await api(`/api/system/notifications/${id}/read`, { method: 'POST' })
        const item = notifications.find((row) => Number(row.id) === id)
        if (item) item.read_at = new Date().toISOString()
        renderNotifications()
      } catch (error) {
        notify(error.message)
      }
    })
  })
}

const loadNotifications = async () => {
  try {
    const data = await api('/api/system/notifications')
    notifications = data.notifications || []
    renderNotifications()
  } catch {
    // jangan mengganggu halaman utama bila notifikasi gagal dimuat
  }
}

const setNotificationPanelOpen = (open) => {
  const panel = document.getElementById('notification-panel')
  if (!panel) return
  panel.classList.toggle('hidden', !open)
}

const searchResultHtml = (type, item) => {
  if (type === 'admin') return `
    <button type="button" class="wb-search-item" data-search-page="admins">
      <span class="wb-search-badge">ADMIN</span>
      <span><strong>${escapeHtml(item.username)}</strong><small>${escapeHtml(item.referral_code || '-')}</small></span>
    </button>`
  if (type === 'worker') return `
    <button type="button" class="wb-search-item" data-search-page="workers">
      <span class="wb-search-badge">WORKER</span>
      <span><strong>${escapeHtml(item.username)}</strong><small>${escapeHtml(item.admin_username || (item.balance_cents != null ? 'Worker' : '-'))}</small></span>
    </button>`
  return `
    <button type="button" class="wb-search-item" data-search-page="${currentUser.role === 'super_admin' ? 'db-monitor' : 'dashboard'}">
      <span class="wb-search-badge">DB</span>
      <span><strong>${escapeHtml(item.name)}</strong><small>#${escapeHtml(item.id)} · ${escapeHtml(item.status)}</small></span>
    </button>`
}

let searchTimer = null
const doGlobalSearch = async (query) => {
  const box = document.getElementById('global-search-results')
  if (!box) return
  if (!query.trim()) {
    box.classList.add('hidden')
    box.innerHTML = ''
    return
  }
  try {
    const data = await api(`/api/system/search?q=${encodeURIComponent(query.trim())}`)
    const groups = []
    if (data.admins?.length) groups.push(data.admins.map((item) => searchResultHtml('admin', item)).join(''))
    if (data.workers?.length) groups.push(data.workers.map((item) => searchResultHtml('worker', item)).join(''))
    if (data.dbs?.length) groups.push(data.dbs.map((item) => searchResultHtml('db', item)).join(''))
    box.innerHTML = groups.join('') || '<div class="wb-search-empty">Tidak ada hasil.</div>'
    box.classList.remove('hidden')
    box.querySelectorAll('[data-search-page]').forEach((button) => {
      button.addEventListener('click', () => {
        page = button.dataset.searchPage
        box.classList.add('hidden')
        const input = document.getElementById('global-search')
        if (input) input.value = ''
        loadPage()
      })
    })
  } catch (error) {
    box.innerHTML = `<div class="wb-search-empty">${escapeHtml(error.message)}</div>`
    box.classList.remove('hidden')
  }
}

const setupGlobalTools = () => {
  const search = document.getElementById('global-search')
  const searchBox = document.getElementById('global-search-results')
  const wrap = document.getElementById('global-search-wrap')
  const button = document.getElementById('notifications-btn')
  const panel = document.getElementById('notification-panel')
  const readAll = document.getElementById('notification-read-all')
  if (search) {
    search.placeholder = currentUser.role === 'super_admin' ? 'Cari admin, worker, DB...' : currentUser.role === 'admin' ? 'Cari worker...' : 'Pencarian tidak tersedia'
    search.disabled = currentUser.role === 'worker'
    search.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => doGlobalSearch(search.value), 220)
    })
    search.addEventListener('focus', () => { if (search.value.trim()) doGlobalSearch(search.value) })
  }
  if (wrap) wrap.classList.toggle('hidden', currentUser.role === 'worker')
  button?.addEventListener('click', (event) => {
    event.stopPropagation()
    setNotificationPanelOpen(panel?.classList.contains('hidden'))
  })
  panel?.addEventListener('click', (event) => event.stopPropagation())
  readAll?.addEventListener('click', async () => {
    try {
      await api('/api/system/notifications/read-all', { method: 'POST' })
      notifications = notifications.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
      renderNotifications()
    } catch (error) {
      notify(error.message)
    }
  })
  document.addEventListener('click', () => {
    searchBox?.classList.add('hidden')
    setNotificationPanelOpen(false)
  })
  loadNotifications()
}

const showWorkerDetailModal = (data) => {
  const existing = document.getElementById('worker-detail-modal')
  existing?.remove()
  const worker = data.worker
  const devices = data.devices || []
  const logs = data.logs || []
  const modal = document.createElement('div')
  modal.id = 'worker-detail-modal'
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
  modal.innerHTML = `
    <div class="card wb-worker-modal">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="wb-page-kicker">// worker.detail</div>
          <h2 class="text-xl font-black">${escapeHtml(worker.username)}</h2>
          <p class="text-sm text-slate-500">Status akun: ${worker.is_active ? 'AKTIF' : 'NONAKTIF'} · Terdaftar ${escapeHtml(worker.created_at)}</p>
        </div>
        <button id="worker-detail-close" class="btn-ghost" type="button">Tutup</button>
      </div>
      <div class="wb-mini-stats">
        ${monitorStat('TOTAL CHAT', data.counts.total_chats, 'monitor-cyan', 'detail-chat')}
        ${monitorStat('SUCCESS', data.counts.success, 'monitor-green', 'detail-success')}
        ${monitorStat('FAILED', data.counts.failed, 'monitor-red', 'detail-failed')}
      </div>
      <div class="mt-5 card-subtle">
        <h3 class="font-bold">Perangkat</h3>
        ${table(['ID', 'Nomor', 'Metode', 'Status'], devices.map((item) => `<tr><td>${item.id}</td><td>${escapeHtml(item.phone || '-')}</td><td>${escapeHtml(item.pairing_method || '-')}</td><td>${statusBadge(item.status, item.status === 'online')}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada perangkat</td></tr>')}
      </div>
      <div class="mt-5 card-subtle">
        <h3 class="font-bold mb-2">Aktivitas terbaru</h3>
        <div class="monitor-live-logs max-h-72 overflow-y-auto">${logs.map(monitorLogRow).join('') || '<div class="monitor-empty">Belum ada aktivitas.</div>'}</div>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  modal.querySelector('#worker-detail-close')?.addEventListener('click', () => modal.remove())
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove() })
}

const navIcons = {
  dashboard: '⌂', 'db-monitor': '◫', admins: '◌', dbs: '▤', settings: '⚙', withdrawals: '◇',
  'monitor-jobs': '◉', workers: '◌', network: '⌁', withdraw: '◇', devices: '◍',
  activity: '▥', 'blast-history': '≋', audit: '◆', health: '✦'
}

const setMobileNavOpen = (open) => {
  document.body.classList.toggle('mobile-nav-open', open)
  document.getElementById('wb-sidebar')?.classList.toggle('is-mobile-open', open)
  document.getElementById('mobile-nav-overlay')?.classList.toggle('is-open', open)
  const toggle = document.getElementById('mobile-nav-toggle')
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  const overlay = document.getElementById('mobile-nav-overlay')
  if (overlay) overlay.setAttribute('aria-hidden', open ? 'false' : 'true')
}

const renderNav = () => {
  const items = menus[currentUser.role] || []
  const html = items.map(([id, label]) => `
    <button data-page="${id}" class="wb-nav-link ${page === id ? 'is-active' : ''}">
      <span class="wb-nav-icon">${navIcons[id] || '◈'}</span>
      <span>${label}</span>
    </button>
  `).join('')
  nav.innerHTML = html
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      page = button.dataset.page
      setMobileNavOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      loadPage()
    })
  })
  const currentLabel = items.find(([id]) => id === page)?.[1] || 'Dashboard'
  const headerPage = document.getElementById('header-page')
  if (headerPage) headerPage.textContent = `WEB BLAST // ${currentLabel}`
  const name = currentUser?.username || 'USER'
  const profileName = document.getElementById('profile-name')
  const profileRole = document.getElementById('profile-role')
  const avatar = document.getElementById('avatar')
  if (profileName) profileName.textContent = name.toUpperCase()
  if (profileRole) profileRole.textContent = roleText[currentUser.role] || currentUser.role
  if (avatar) avatar.textContent = name.slice(0, 1).toUpperCase()
}

const bankForm = (user) => `
  <div class="card">
    <h2 class="font-medium">Rekening pencairan</h2>
    <form id="bank-form" class="mt-3 grid gap-3 md:grid-cols-3">
      <input class="input" name="bankName" placeholder="Bank" value="${user.bank_name || ''}" required />
      <input class="input" name="bankAccount" placeholder="No. rekening" value="${user.bank_account || ''}" required />
      <input class="input" name="bankHolder" placeholder="Nama pemilik" value="${user.bank_holder || ''}" required />
      <button class="btn-primary md:col-span-3" type="submit">Simpan rekening</button>
    </form>
  </div>
`

const withdrawForm = (user, settings, withdrawals, endpoint) => `
  <div class="grid gap-4">
    ${bankForm(user)}
    <div class="card">
      <h2 class="font-medium">Ajukan withdraw</h2>
      <p class="mt-1 text-sm text-slate-400">Saldo: ${rupiah(user.balance_cents)} · Terkunci: ${rupiah(user.locked_cents)} · Min ${rupiah(settings.min_withdraw_cents)}</p>
      <form id="wd-form" class="mt-3 flex flex-col gap-3 sm:flex-row">
        <input class="input" name="amountRupiah" type="number" min="1" placeholder="Nominal rupiah" required />
        <button class="btn-primary" type="submit">Ajukan</button>
      </form>
    </div>
    <div class="card">
      <h2 class="mb-3 font-medium">Riwayat</h2>
      ${table(['ID', 'Nominal', 'Status', 'Waktu'], withdrawals.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2">${item.id}</td>
          <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.amount_cents)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.status}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.created_at}</td>
        </tr>
      `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="4">Belum ada</td></tr>')}
    </div>
    <p id="page-error" class="hidden text-sm text-red-400"></p>
  </div>
`

const bindWithdraw = (prefix) => {
  document.getElementById('bank-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      await api(`/api/${prefix}/bank`, {
        method: 'PUT',
        body: JSON.stringify({
          bankName: data.get('bankName'),
          bankAccount: data.get('bankAccount'),
          bankHolder: data.get('bankHolder')
        })
      })
      loadPage()
    } catch (error) {
      setError(error.message)
    }
  })
  document.getElementById('wd-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      await api(`/api/${prefix}/withdrawals`, {
        method: 'POST',
        body: JSON.stringify({ amountRupiah: Number(data.get('amountRupiah')) })
      })
      notify('Permintaan withdraw dikirim', 'success')
      loadPage()
    } catch (error) {
      setError(error.message)
    }
  })
}

const renderSuperDashboard = async () => {
  const data = await api('/api/super/monitor')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.monitor</div><h1 class="wb-page-title">GLOBAL MONITOR</h1><p class="wb-page-sub">Ringkasan aktivitas jaringan, target database, chat terkirim, antrean withdraw, dan kewajiban pembayaran berjalan.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
      ${card('Admin', data.totals.admins)}
      ${card('Worker', data.totals.workers)}
      ${card('DB aktif', data.totals.activeDbs)}
      ${card('WA online', data.totals.workersOnline)}
      ${card('Chat terkirim', data.totals.chats)}
      ${card('Target aktif sisa', data.totals.pendingTargets)}
      ${card('Withdraw pending', data.totals.pendingWithdrawals)}
    </div>

    <div class="wb-payable-grid mt-5">
      ${payableCard(
        'Gaji Worker Yang Harus Dibayar',
        rupiah(data.totals.workerPayrollDueCents),
        'red',
        'Akumulasi saldo + penarikan yang masih terkunci untuk seluruh worker.'
      )}
      ${payableCard(
        'Komisi Admin Yang Harus Dibayar',
        rupiah(data.totals.adminCommissionDueCents),
        'yellow',
        'Akumulasi saldo + penarikan yang masih terkunci untuk seluruh admin.'
      )}
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <div class="card">
        <h2 class="mb-3 font-medium">Admin</h2>
        ${table(['User', 'Referral', 'Worker', 'WA online', 'Chat', 'Saldo'], data.admins.map((item) => `
          <tr>
            <td class="border-b border-slate-800 px-3 py-2">${item.username}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.referral_code}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.worker_count}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.wa_online}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.total_chats}</td>
            <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.balance_cents)}</td>
          </tr>
        `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="6">Belum ada admin</td></tr>')}
      </div>
      <div class="card">
        <h2 class="mb-3 font-medium">Worker</h2>
        ${table(['User', 'Admin', 'WA', 'Chat', 'Blast', 'Saldo'], data.workers.map((item) => `
          <tr>
            <td class="border-b border-slate-800 px-3 py-2">${item.username}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.admin_username || '-'}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.wa_online}/${item.device_count}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.total_chats}</td>
            <td class="border-b border-slate-800 px-3 py-2">${item.is_running ? 'jalan' : 'stop'}</td>
            <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.balance_cents)}</td>
          </tr>
        `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="6">Belum ada worker</td></tr>')}
      </div>
    </div>
    ${liveLogsCard(data.logs, 'Log blast live')}
  `
}

const renderAdmins = async () => {
  const data = await api('/api/super/admins')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.network</div><h1 class="wb-page-title">ADMIN MANAGEMENT</h1><p class="wb-page-sub">Kelola akun admin, referral, status akses, dan keamanan akun.</p></div>
    <div class="card mb-4">
      <form id="admin-form" class="grid gap-3 md:grid-cols-3">
        <input class="input" name="username" placeholder="Username admin" required />
        <input class="input" name="password" type="password" placeholder="Password awal" required />
        <button class="btn-primary" type="submit">Tambah admin</button>
      </form>
      <p class="mt-2 text-xs text-slate-500">Setelah dibuat, admin bisa langsung membagikan referral untuk merekrut worker.</p>
    </div>
    <div class="card">
      ${table(['Username', 'Referral', 'Worker', 'Aktif', 'Saldo', 'Aksi'], data.admins.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2">${escapeHtml(item.username)}</td>
          <td class="border-b border-slate-800 px-3 py-2"><div class="font-mono">${escapeHtml(item.referral_code || '-')}</div><button class="btn-ghost mt-1" data-copy-ref="${escapeHtml(item.referral_code || '')}" type="button">Salin link</button></td>
          <td class="border-b border-slate-800 px-3 py-2">${item.active_worker_count || 0}/${item.worker_count || 0}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.is_active ? statusBadge('active', true) : statusBadge('inactive', false)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.balance_cents)}</td>
          <td class="border-b border-slate-800 px-3 py-2"><div class="flex flex-wrap gap-1">
            <button class="btn-ghost" type="button" data-user-toggle="${item.id}" data-active="${item.is_active ? 1 : 0}">${item.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button class="btn-danger" type="button" data-user-password="${item.id}">Reset password</button>
          </div></td>
        </tr>
      `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="6">Belum ada admin</td></tr>')}
    </div>
  `
  document.getElementById('admin-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const dataForm = new FormData(event.target)
    try {
      await api('/api/super/admins', { method: 'POST', body: JSON.stringify({ username: dataForm.get('username'), password: dataForm.get('password') }) })
      notify('Admin berhasil dibuat', 'success')
      loadPage()
    } catch (error) { setError(error.message) }
  })
  view.querySelectorAll('[data-copy-ref]').forEach((button) => button.addEventListener('click', async () => {
    const link = referralLink(button.dataset.copyRef)
    await navigator.clipboard?.writeText(link)
    notify('Link referral disalin', 'success')
  }))
  view.querySelectorAll('[data-user-toggle]').forEach((button) => button.addEventListener('click', async () => {
    const active = button.dataset.active === '1'
    try {
      await api(`/api/super/users/${button.dataset.userToggle}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) })
      notify(`Admin ${active ? 'dinonaktifkan' : 'diaktifkan'}`, 'success')
      loadPage()
    } catch (error) { setError(error.message) }
  }))
  view.querySelectorAll('[data-user-password]').forEach((button) => button.addEventListener('click', async () => {
    const password = window.prompt('Masukkan password baru minimal 6 karakter:')
    if (!password) return
    try {
      await api(`/api/super/users/${button.dataset.userPassword}/password`, { method: 'PATCH', body: JSON.stringify({ password }) })
      notify('Password berhasil direset', 'success')
    } catch (error) { setError(error.message) }
  }))
}

const renderDbs = async () => {
  const data = await api('/api/super/dbs')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.targets</div><h1 class="wb-page-title">TARGET DATABASE</h1><p class="wb-page-sub">Upload daftar nomor, atur start/stop otomatis, dan kendalikan status database.</p></div>
    <div class="card mb-4">
      <form id="db-form" class="grid gap-3 md:grid-cols-3">
        <input class="input" name="name" placeholder="Nama database" required />
        <input class="input" name="file" type="file" accept=".txt" required />
        <button class="btn-primary" type="submit">Unggah .txt</button>
      </form>
      <p class="mt-2 text-xs text-slate-400">Satu nomor WhatsApp per baris. Duplikat dilewati.</p>
      <p id="page-error" class="mt-2 hidden text-sm text-red-400"></p>
    </div>
    <div class="card">
      ${table(['Nama', 'Status', 'Total', 'Pending', 'Terkirim', 'Gagal', 'Jadwal', 'Aksi'], data.dbs.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2">${item.name}</td>
          <td class="border-b border-slate-800 px-3 py-2">${statusBadge(item.status, item.status === 'active')}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.total}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.pending}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.sent}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.failed}</td>
          <td class="border-b border-slate-800 px-3 py-2">
            <div class="grid gap-2 text-xs" data-schedule-row="${item.id}">
              <label class="flex items-center gap-2">
                <input data-sched-start="${item.id}" type="checkbox" ${item.schedule_start ? 'checked' : ''} />
                Start otomatis
              </label>
              <input class="input" data-sched-start-at="${item.id}" type="time" value="${String(item.schedule_start_at || '').slice(0, 5)}" />
              <label class="flex items-center gap-2">
                <input data-sched-stop="${item.id}" type="checkbox" ${item.schedule_stop ? 'checked' : ''} />
                Stop otomatis
              </label>
              <input class="input" data-sched-stop-at="${item.id}" type="time" value="${String(item.schedule_stop_at || '').slice(0, 5)}" />
              <p class="text-slate-500">Waktu WIB</p>
              <label class="flex items-center gap-2 text-slate-400">
                <input data-autostart="${item.id}" type="checkbox" ${item.auto_start ? 'checked' : ''} /> antrian start
              </label>
              <label class="flex items-center gap-2 text-slate-400">
                <input data-autostop="${item.id}" type="checkbox" ${item.auto_stop ? 'checked' : ''} /> antrian stop
              </label>
              <button class="btn-ghost" type="button" data-sched-save="${item.id}">Simpan jadwal</button>
            </div>
          </td>
          <td class="border-b border-slate-800 px-3 py-2">
            ${item.status === 'active'
              ? `<button class="btn-ghost" data-stop="${item.id}">Stop</button>`
              : `<button class="btn-primary" data-start="${item.id}">Start</button>`}
          </td>
        </tr>
      `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="8">Belum ada database</td></tr>')}
    </div>
    <div id="db-auto-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/60 p-4">
      <div class="card w-full max-w-md">
        <h2 class="text-lg font-semibold">Pengaturan Otomatisasi Database</h2>
        <p class="mt-2 text-sm text-slate-400">Apakah database ini akan dijalankan secara otomatis?</p>
        <div id="db-auto-choice" class="mt-4 flex gap-2">
          <button id="db-auto-no" class="btn-ghost" type="button">Tidak</button>
          <button id="db-auto-yes" class="btn-primary" type="button">Ya</button>
        </div>
        <form id="db-auto-form" class="mt-4 hidden space-y-3">
          <label class="flex items-center gap-2 text-sm">
            <input id="db-auto-start" type="checkbox" checked /> Start Otomatis
          </label>
          <label class="grid gap-1 text-sm">Waktu Start
            <input id="db-auto-start-at" class="input" type="time" />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input id="db-auto-stop" type="checkbox" checked /> Stop Otomatis
          </label>
          <label class="grid gap-1 text-sm">Waktu Stop
            <input id="db-auto-stop-at" class="input" type="time" />
          </label>
          <p class="text-xs text-slate-500">Waktu WIB</p>
          <p id="db-auto-error" class="hidden text-sm text-red-400"></p>
          <button class="btn-primary" type="submit">Simpan Pengaturan</button>
        </form>
      </div>
    </div>
  `
  let uploadedDbId = null
  const dbAutoModal = document.getElementById('db-auto-modal')
  const dbAutoForm = document.getElementById('db-auto-form')
  const dbAutoError = document.getElementById('db-auto-error')
  const setDbAutoModalOpen = (open) => {
    dbAutoModal.classList.toggle('hidden', !open)
    dbAutoModal.classList.toggle('flex', open)
  }
  const setDbAutoError = (message) => {
    dbAutoError.textContent = message || ''
    dbAutoError.classList.toggle('hidden', !message)
    notify(message)
  }
  const validHHmm = (value) => {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return false
    const hours = Number(match[1])
    const minutes = Number(match[2])
    return hours <= 23 && minutes <= 59
  }
  const finishDbUpload = () => {
    uploadedDbId = null
    setDbAutoModalOpen(false)
    loadPage()
  }
  document.getElementById('db-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.target)
    try {
      const { db: created } = await api('/api/super/dbs', { method: 'POST', body: form })
      uploadedDbId = created.id
      document.getElementById('db-auto-choice').classList.remove('hidden')
      dbAutoForm.classList.add('hidden')
      dbAutoForm.reset()
      document.getElementById('db-auto-start').checked = true
      document.getElementById('db-auto-stop').checked = true
      setDbAutoError('')
      setDbAutoModalOpen(true)
    } catch (error) {
      setError(error.message)
    }
  })
  document.getElementById('db-auto-no').addEventListener('click', finishDbUpload)
  document.getElementById('db-auto-yes').addEventListener('click', () => {
    document.getElementById('db-auto-choice').classList.add('hidden')
    dbAutoForm.classList.remove('hidden')
  })
  dbAutoForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const scheduleStart = document.getElementById('db-auto-start').checked
    const scheduleStop = document.getElementById('db-auto-stop').checked
    const scheduleStartAt = document.getElementById('db-auto-start-at').value
    const scheduleStopAt = document.getElementById('db-auto-stop-at').value
    if (scheduleStart && !validHHmm(scheduleStartAt)) {
      setDbAutoError('Waktu Start wajib diisi dengan format HH:MM')
      return
    }
    if (scheduleStop && !validHHmm(scheduleStopAt)) {
      setDbAutoError('Waktu Stop wajib diisi dengan format HH:MM')
      return
    }
    try {
      await api(`/api/super/dbs/${uploadedDbId}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduleStart, scheduleStop, scheduleStartAt, scheduleStopAt })
      })
      finishDbUpload()
    } catch (error) {
      setDbAutoError(error.message)
    }
  })
  view.querySelectorAll('[data-start]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/super/dbs/${button.dataset.start}/start`, { method: 'POST' })
      loadPage()
    })
  })
  view.querySelectorAll('[data-stop]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/super/dbs/${button.dataset.stop}/stop`, { method: 'POST' })
      loadPage()
    })
  })
  view.querySelectorAll('[data-autostart], [data-autostop]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.autostart || input.dataset.autostop
      const startEl = view.querySelector(`[data-autostart="${id}"]`)
      const stopEl = view.querySelector(`[data-autostop="${id}"]`)
      try {
        await api(`/api/super/dbs/${id}/auto`, {
          method: 'POST',
          body: JSON.stringify({
            autoStart: startEl?.checked,
            autoStop: stopEl?.checked
          })
        })
      } catch (error) {
        setError(error.message)
      }
    })
  })
  view.querySelectorAll('[data-sched-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const { schedSave: id } = button.dataset
      try {
        await api(`/api/super/dbs/${id}/schedule`, {
          method: 'POST',
          body: JSON.stringify({
            scheduleStart: view.querySelector(`[data-sched-start="${id}"]`)?.checked,
            scheduleStop: view.querySelector(`[data-sched-stop="${id}"]`)?.checked,
            scheduleStartAt: view.querySelector(`[data-sched-start-at="${id}"]`)?.value,
            scheduleStopAt: view.querySelector(`[data-sched-stop-at="${id}"]`)?.value
          })
        })
        notify('Jadwal tersimpan', 'success')
        button.textContent = 'Tersimpan'
        setTimeout(() => { button.textContent = 'Simpan jadwal' }, 1500)
      } catch (error) {
        setError(error.message)
      }
    })
  })
}

const renderSuperDbMonitor = async () => {
  const data = await api('/api/super/db-monitor')
  view.innerHTML = `
    <section class="monitor-page">
      <div class="monitor-kicker">// super_admin.db-monitor</div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 class="monitor-title">MONITOR DB REALTIME</h1><p class="monitor-subtitle">Pantau volume database aktif dan kendalikan Start / Stop secara realtime.</p></div>
        <div class="monitor-live-badge"><span></span> LIVE CONTROL</div>
      </div>
      <div class="monitor-stats mt-6">
        ${monitorStat('TOTAL DB', data.totals.totalDb, 'monitor-cyan', 'dbm-total')}
        ${monitorStat('DB AKTIF', data.totals.activeDb, 'monitor-green', 'dbm-active')}
        ${monitorStat('PENDING', data.totals.pending, 'monitor-amber', 'dbm-pending')}
        ${monitorStat('PROCESSING', data.totals.processing, 'monitor-sky', 'dbm-processing')}
        ${monitorStat('SUCCESS', data.totals.totalSuccess, 'monitor-green', 'dbm-success')}
        ${monitorStat('FAILED', data.totals.totalFailed, 'monitor-red', 'dbm-failed')}
      </div>
      <div class="card mt-6">
        <div class="wb-section-bar"><div><div class="wb-page-kicker">DB VOLUME</div><h2>DATABASE CONTROL</h2></div><span class="wb-live-chip">REALTIME</span></div>
        ${table(['DB', 'Status', 'Total', 'Pending', 'Processing', 'Success', 'Failed', 'Jadwal', 'Aksi'], data.dbs.map((item) => `
          <tr data-db-row="${item.id}">
            <td class="border-b border-slate-800 px-3 py-2"><strong>${escapeHtml(item.name)}</strong><div class="text-xs text-slate-500">#${item.id}</div></td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-status>${statusBadge(item.status, item.status === 'active')}</td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-total>${item.total}</td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-pending>${item.pending}</td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-processing>${item.processing}</td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-sent>${item.sent}</td>
            <td class="border-b border-slate-800 px-3 py-2" data-db-failed>${item.failed}</td>
            <td class="border-b border-slate-800 px-3 py-2 text-xs text-slate-400">${item.schedule_start_at || '-'} → ${item.schedule_stop_at || '-'}</td>
            <td class="border-b border-slate-800 px-3 py-2"><div class="flex gap-1">
              ${item.status === 'active' ? `<button class="btn-danger" type="button" data-db-stop="${item.id}">Stop</button>` : `<button class="btn-primary" type="button" data-db-start="${item.id}">Start</button>`}
              <button class="btn-ghost" type="button" data-db-open="${item.id}">Atur</button>
            </div></td>
          </tr>
        `).join('') || '<tr><td colspan="9" class="px-3 py-3 text-slate-500">Belum ada database.</td></tr>')}
      </div>
      ${liveLogsCard(data.logs, 'Global DB & Blast Activity')}
    </section>
  `
  view.querySelectorAll('[data-db-start]').forEach((button) => button.addEventListener('click', async () => {
    try { await api(`/api/super/dbs/${button.dataset.dbStart}/start`, { method: 'POST' }); notify('Database dimulai', 'success'); loadPage() } catch (error) { setError(error.message) }
  }))
  view.querySelectorAll('[data-db-stop]').forEach((button) => button.addEventListener('click', async () => {
    try { await api(`/api/super/dbs/${button.dataset.dbStop}/stop`, { method: 'POST' }); notify('Database dihentikan', 'success'); loadPage() } catch (error) { setError(error.message) }
  }))
  view.querySelectorAll('[data-db-open]').forEach((button) => button.addEventListener('click', () => {
    page = 'dbs'
    loadPage()
    notify(`Buka halaman Database untuk mengatur DB #${button.dataset.dbOpen}`, 'info')
  }))
}

const renderSuperWorkers = async () => {
  const data = await api('/api/super/workers')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.workers</div><h1 class="wb-page-title">GLOBAL WORKER MONITOR</h1><p class="wb-page-sub">Pantau seluruh worker lintas admin, perangkat, aktivitas blast, saldo, dan status akun.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Total worker', data.workers.length)}
      ${card('Worker aktif', data.workers.filter((item) => item.is_active).length)}
      ${card('WA online', data.workers.reduce((n, item) => n + Number(item.wa_online || 0), 0))}
      ${card('Blast aktif', data.workers.filter((item) => item.is_running).length)}
    </div>
    <div class="card mt-4">
      ${table(['Worker', 'Admin', 'WA', 'Success', 'Failed', 'Saldo', 'Akun', 'Aksi'], data.workers.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2"><strong>${escapeHtml(item.username)}</strong><div class="text-xs text-slate-500">#${item.id}</div></td>
          <td class="border-b border-slate-800 px-3 py-2">${escapeHtml(item.admin_username || '-')}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.wa_online}/${item.device_count}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.total_success}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.total_failed}</td>
          <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.balance_cents)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.is_active ? statusBadge('active', true) : statusBadge('inactive', false)}</td>
          <td class="border-b border-slate-800 px-3 py-2"><div class="flex flex-wrap gap-1">
            <button class="btn-ghost" type="button" data-super-worker-toggle="${item.id}" data-active="${item.is_active ? 1 : 0}">${item.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button class="btn-danger" type="button" data-super-worker-password="${item.id}">Reset password</button>
          </div></td>
        </tr>
      `).join('') || '<tr><td colspan="8" class="px-3 py-3 text-slate-500">Belum ada worker.</td></tr>')}
    </div>
  `
  view.querySelectorAll('[data-super-worker-toggle]').forEach((button) => button.addEventListener('click', async () => {
    const active = button.dataset.active === '1'
    try { await api(`/api/super/users/${button.dataset.superWorkerToggle}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !active }) }); notify(`Worker ${active ? 'dinonaktifkan' : 'diaktifkan'}`, 'success'); loadPage() } catch (error) { setError(error.message) }
  }))
  view.querySelectorAll('[data-super-worker-password]').forEach((button) => button.addEventListener('click', async () => {
    const password = window.prompt('Password baru minimal 6 karakter:')
    if (!password) return
    try { await api(`/api/super/users/${button.dataset.superWorkerPassword}/password`, { method: 'PATCH', body: JSON.stringify({ password }) }); notify('Password worker berhasil direset', 'success') } catch (error) { setError(error.message) }
  }))
}

const renderAuditLogs = async () => {
  const data = await api('/api/super/audit-logs')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.audit</div><h1 class="wb-page-title">AUDIT LOG</h1><p class="wb-page-sub">Jejak aksi penting seluruh operator dan sistem dalam satu timeline.</p></div>
    <div class="card"><div class="monitor-live-logs wb-scroll-70">
      ${(data.logs || []).map((item) => `<div class="monitor-log-row"><div class="monitor-log-meta"><span>${escapeHtml(item.created_at)}</span><span class="monitor-log-worker">${escapeHtml(item.actor_username || 'SYSTEM')}</span><span>${escapeHtml(item.actor_role || '')}</span></div><div class="monitor-log-main"><span class="monitor-log-status text-amber-300">${escapeHtml(item.action).toUpperCase()}</span><span>${escapeHtml(item.entity_type || '-')} ${item.entity_id ? '#'+item.entity_id : ''}</span><span class="text-slate-500">${escapeHtml(item.detail || '')}</span></div></div>`).join('') || '<div class="monitor-empty">Belum ada audit log.</div>'}
    </div></div>
  `
}

const renderSystemHealth = async () => {
  const data = await api('/api/super/health')
  const healthBadge = (status) => status === 'online' ? statusBadge('online', true) : statusBadge(status, false)
  const formatUptime = (seconds) => {
    const s = Math.floor(Number(seconds || 0)); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.health</div><h1 class="wb-page-title">SYSTEM HEALTH</h1><p class="wb-page-sub">Status server, database, websocket, WhatsApp, dan engine blast.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      ${card('Server', healthBadge(data.server.status))}
      ${card('Database', healthBadge(data.database.status))}
      ${card('WebSocket', healthBadge(data.websocket.status))}
      ${card('WA online', data.whatsapp.online)}
      ${card('Blast aktif', data.blast.running)}
    </div>
    <div class="mt-5 grid gap-4 lg:grid-cols-2">
      <div class="card"><h2 class="font-bold mb-3">Runtime</h2><div class="space-y-2 text-sm text-slate-400"><p>Node: <span class="font-mono text-white">${escapeHtml(data.server.node)}</span></p><p>Uptime: <span class="text-white">${formatUptime(data.server.uptime)}</span></p><p>RSS memory: <span class="text-white">${data.server.memoryMb} MB</span></p><p>Heap: <span class="text-white">${data.server.heapUsedPercent}%</span></p></div></div>
      <div class="card"><h2 class="font-bold mb-3">Database</h2><div class="space-y-2 text-sm text-slate-400"><p>Integrity: <span class="text-white">${escapeHtml(data.database.integrity)}</span></p><p>DB aktif: <span class="text-white">${data.database.activeDbs}</span></p><p>WA online: <span class="text-white">${data.whatsapp.online}</span></p><p>Blast running: <span class="text-white">${data.blast.running}</span></p></div></div>
    </div>
    <div class="card mt-4"><div class="wb-section-bar"><h2>HEALTH TIMELINE</h2><span class="wb-live-chip">AUTO REFRESH 10s</span></div><p class="text-sm text-slate-500">Halaman ini dapat dimuat ulang tanpa mengganggu sesi WhatsApp.</p></div>
  `
}

const renderSettings = async () => {
  const { settings } = await api('/api/super/settings')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// super_admin.settings</div><h1 class="wb-page-title">SYSTEM SETTINGS</h1><p class="wb-page-sub">Atur rate worker, komisi admin, minimum withdraw, dan pesan broadcast.</p></div>
    <form id="set-form" class="card grid gap-3">
      <label class="grid gap-1 text-sm">Upah worker per chat (rupiah)
        <input class="input" name="workerRateRupiah" type="number" value="${settings.worker_rate_cents / 100}" required />
      </label>
      <label class="grid gap-1 text-sm">Komisi admin per chat (rupiah)
        <input class="input" name="adminCommissionRupiah" type="number" value="${settings.admin_commission_cents / 100}" required />
      </label>
      <label class="grid gap-1 text-sm">Komisi worker referral L2 per chat (rupiah)
        <input class="input" name="workerReferralRupiah" type="number" value="${(settings.worker_referral_cents || 0) / 100}" required />
      </label>
      <label class="grid gap-1 text-sm">Minimum withdraw (rupiah)
        <input class="input" name="minWithdrawRupiah" type="number" value="${settings.min_withdraw_cents / 100}" required />
      </label>
      <label class="grid gap-1 text-sm">Pesan blast
        <textarea class="input min-h-32" name="blastMessage" required>${settings.blast_message}</textarea>
      </label>
      <p id="page-error" class="hidden text-sm text-red-400"></p>
      <button class="btn-primary" type="submit">Simpan</button>
    </form>
  `
  document.getElementById('set-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      await api('/api/super/settings', {
        method: 'PUT',
        body: JSON.stringify({
          workerRateRupiah: Number(data.get('workerRateRupiah')),
          adminCommissionRupiah: Number(data.get('adminCommissionRupiah')),
          workerReferralRupiah: Number(data.get('workerReferralRupiah')),
          minWithdrawRupiah: Number(data.get('minWithdrawRupiah')),
          blastMessage: data.get('blastMessage')
        })
      })
      loadPage()
    } catch (error) {
      setError(error.message)
    }
  })
}

const renderSuperWithdrawals = async () => {
  const data = await api('/api/super/withdrawals')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// payout.queue</div><h1 class="wb-page-title">WITHDRAW QUEUE</h1><p class="wb-page-sub">Kelola request pencairan dan status payout semua akun.</p></div>
    <div class="card">
      ${table(['User', 'Role', 'Nominal', 'Rekening', 'Status', 'Aksi'], data.withdrawals.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2">${item.username}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.role}</td>
          <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.amount_cents)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.bank_name} ${item.bank_account} a.n. ${item.bank_holder}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.status}</td>
          <td class="border-b border-slate-800 px-3 py-2">
            ${item.status === 'pending' ? `
              <button class="btn-primary mb-1" data-accept="${item.id}">Terima</button>
              <button class="btn-danger" data-reject="${item.id}">Tolak</button>
            ` : '-'}
          </td>
        </tr>
      `).join('') || '<tr><td class="px-3 py-2 text-slate-400" colspan="6">Belum ada</td></tr>')}
    </div>
  `
  view.querySelectorAll('[data-accept]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/super/withdrawals/${button.dataset.accept}/accept`, { method: 'POST' })
      loadPage()
    })
  })
  view.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/super/withdrawals/${button.dataset.reject}/reject`, { method: 'POST' })
      loadPage()
    })
  })
}

const monitorLogStatus = (status) => ({
  wa_connected: 'WA CONNECTED',
  wa_disconnected: 'WA OFFLINE',
  sent: 'SUCCESS',
  failed: 'FAILED',
  start: 'BLAST START',
  stop: 'BLAST STOP',
  limit: 'AUTO STOP'
}[status] || String(status || 'LOG').toUpperCase())

const monitorLogClass = (status) => ({
  wa_connected: 'text-cyan-300',
  wa_disconnected: 'text-slate-400',
  sent: 'text-emerald-300',
  failed: 'text-red-300',
  start: 'text-amber-300',
  stop: 'text-slate-300',
  limit: 'text-violet-300'
}[status] || 'text-slate-300')

const monitorStat = (label, value, tone, key) => `
  <div class="monitor-stat">
    <p class="monitor-stat-label">${label}</p>
    <p data-monitor-stat="${key}" class="monitor-stat-value ${tone}">${Number(value ?? 0).toLocaleString('id-ID')}</p>
  </div>
`

const monitorLogRow = (item) => `
  <div class="monitor-log-row">
    <div class="monitor-log-meta">
      <span>${item.created_at || ''}</span>
      ${item.worker_username ? `<span class="monitor-log-worker">${item.worker_username}</span>` : ''}
    </div>
    <div class="monitor-log-main">
      <span class="monitor-log-status ${monitorLogClass(item.status)}">${monitorLogStatus(item.status)}</span>
      ${item.phone ? `<span class="font-mono text-slate-300">${item.phone}</span>` : ''}
      ${item.detail ? `<span class="text-slate-500">${item.detail}</span>` : ''}
    </div>
  </div>
`

const renderAdminMonitorJobs = async () => {
  const data = await api('/api/admin/monitor-jobs')
  view.innerHTML = `
    <section class="monitor-page">
      <div class="monitor-kicker">// monitor.jobs</div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="monitor-title">MONITOR JOBS REALTIME</h1>
          <p class="monitor-subtitle">Pantau volume DB, progres blast, dan aktivitas worker jaringan referral Anda secara realtime.</p>
        </div>
        <div class="monitor-live-badge"><span></span> LIVE</div>
      </div>

      <div class="monitor-stats mt-6">
        ${monitorStat('TOTAL DB', data.totals.totalDb, 'monitor-cyan', 'total-db')}
        ${monitorStat('PENDING', data.totals.pending, 'monitor-amber', 'pending')}
        ${monitorStat('PROCESSING', data.totals.processing, 'monitor-sky', 'processing')}
        ${monitorStat('TOTAL SUCCESS', data.totals.totalSuccess, 'monitor-green', 'success')}
        ${monitorStat('TOTAL FAILED', data.totals.totalFailed, 'monitor-red', 'failed')}
      </div>

      <div class="monitor-terminal mt-6">
        <div class="monitor-terminal-top">
          <div class="monitor-terminal-brand">
            <span class="monitor-dot red"></span>
            <span class="monitor-dot amber"></span>
            <span class="monitor-dot green"></span>
            <span>terminal · live_worker_logs</span>
          </div>
          <span class="monitor-terminal-user">@${currentUser?.username || 'admin'}</span>
        </div>
        <div class="monitor-terminal-caption">WA connection · blast success · blast failed</div>
        <div id="monitor-live-logs" class="monitor-live-logs">
          ${(data.logs || []).map(monitorLogRow).join('') || '<div class="monitor-empty">Menunggu aktivitas...</div>'}
        </div>
      </div>
    </section>
  `
}

const refreshAdminMonitorStats = async () => {
  if (currentUser?.role !== 'admin' || page !== 'monitor-jobs') return
  try {
    const data = await api('/api/admin/monitor-jobs')
    const values = {
      'total-db': data.totals.totalDb,
      pending: data.totals.pending,
      processing: data.totals.processing,
      success: data.totals.totalSuccess,
      failed: data.totals.totalFailed
    }
    Object.entries(values).forEach(([key, value]) => {
      const el = document.querySelector(`[data-monitor-stat="${key}"]`)
      if (el) el.textContent = Number(value ?? 0).toLocaleString('id-ID')
    })
  } catch {
    // biarkan nilai yang sudah tampil
  }
}

const scheduleAdminMonitorStatsRefresh = () => {
  if (monitorStatsRefreshTimer) clearTimeout(monitorStatsRefreshTimer)
  monitorStatsRefreshTimer = setTimeout(() => {
    monitorStatsRefreshTimer = null
    refreshAdminMonitorStats().catch(() => {})
  }, 500)
}

const prependMonitorLog = (item) => {
  const box = document.getElementById('monitor-live-logs')
  if (!box) return
  box.querySelector('.monitor-empty')?.remove()
  box.insertAdjacentHTML('afterbegin', monitorLogRow(item))
  while (box.children.length > 80) box.removeChild(box.lastElementChild)
}

const renderAdminDashboard = async () => {
  const data = await api('/api/admin/dashboard')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// admin.dashboard</div><h1 class="wb-page-title">ADMIN CONTROL</h1><p class="wb-page-sub">Monitor worker referral, koneksi WA, blast, dan saldo komisi.</p></div>
    <p class="mb-4 text-sm text-slate-400">Kode referral: <span class="font-mono text-brand-500">${data.user.referral_code}</span></p>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Jumlah worker', data.workerCount)}
      ${card('WA worker online', data.waOnline)}
      ${card('Total blast', data.totalChats)}
      ${card('Saldo komisi', rupiah(data.user.balance_cents))}
    </div>
    <p class="mt-4 text-sm text-slate-400">Tautan referral:
      <a class="text-brand-500 hover:underline" href="${referralLink(data.user.referral_code)}">${referralLink(data.user.referral_code)}</a>
    </p>
    ${liveLogsCard(data.logs, 'Log worker live')}
  `
}

const renderAdminWorkers = async () => {
  const data = await api('/api/admin/workers')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// admin.workers</div><h1 class="wb-page-title">REFERRAL WORKERS</h1><p class="wb-page-sub">Daftar worker di bawah admin beserta perangkat, aktivitas blast, dan status akun.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Total worker', data.workers.length)}
      ${card('Worker aktif', data.workers.filter((item) => item.is_active).length)}
      ${card('WA online', data.workers.reduce((n, item) => n + Number(item.wa_online || 0), 0))}
      ${card('Blast aktif', data.workers.filter((item) => item.is_running).length)}
    </div>
    <div class="card mt-4">
      ${table(['Username', 'WA', 'Perangkat', 'Success', 'Failed', 'Saldo', 'Akun', 'Aksi'], data.workers.map((item) => `
        <tr>
          <td class="border-b border-slate-800 px-3 py-2">${escapeHtml(item.username)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.wa_online}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.device_count}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.total_success}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.total_failed}</td>
          <td class="border-b border-slate-800 px-3 py-2">${rupiah(item.balance_cents)}</td>
          <td class="border-b border-slate-800 px-3 py-2">${item.is_active ? statusBadge('active', true) : statusBadge('inactive', false)}</td>
          <td class="border-b border-slate-800 px-3 py-2"><button class="btn-primary" type="button" data-worker-detail="${item.id}">Detail</button></td>
        </tr>
      `).join('') || '<tr><td colspan="8" class="px-3 py-3 text-slate-500">Belum ada worker</td></tr>')}
    </div>
  `
  view.querySelectorAll('[data-worker-detail]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const data = await api(`/api/admin/workers/${button.dataset.workerDetail}`)
      showWorkerDetailModal(data)
    } catch (error) { setError(error.message) }
  }))
}

const renderAdminActivity = async () => {
  const data = await api('/api/admin/activity')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// admin.activity</div><h1 class="wb-page-title">ACTIVITY HISTORY</h1><p class="wb-page-sub">Riwayat aktivitas worker yang terhubung ke jaringan referral admin.</p></div>
    <div class="card"><div class="monitor-live-logs wb-scroll-70">
      ${(data.activities || []).map(monitorLogRow).join('') || '<div class="monitor-empty">Belum ada aktivitas.</div>'}
    </div></div>
  `
}

const renderRoleWithdraw = async (prefix) => {
  const dash = prefix === 'admin'
    ? await api('/api/admin/dashboard')
    : await api('/api/worker/dashboard')
  const list = await api(`/api/${prefix}/withdrawals`)
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// ${prefix}.withdraw</div><h1 class="wb-page-title">WITHDRAW</h1><p class="wb-page-sub">Atur rekening pencairan, ajukan withdraw, dan lihat riwayat payout.</p></div>
    ${withdrawForm(dash.user, dash.settings, list.withdrawals, prefix)}
  `
  bindWithdraw(prefix)
}

const speedOptions = (selected, superReady) => ['siput', 'slow', 'santai', 'brutal', 'super_brutal'].map((mode) => {
  const disabled = mode === 'super_brutal' && !superReady
  return `<option value="${mode}" ${selected === mode ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${mode}${mode === 'super_brutal' ? ' (4 WA nomor sama)' : ''}</option>`
}).join('')

const renderWorkerDashboard = async () => {
  const data = await api('/api/worker/dashboard')
  const running = data.blast.isRunning
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// worker.dashboard</div><h1 class="wb-page-title">BLAST CONTROL</h1><p class="wb-page-sub">Kelola kecepatan blast, koneksi perangkat, progress pengiriman, dan saldo.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Komisi per chat', rupiah(data.settings.worker_rate_cents))}
      ${card('DB tersedia', data.blast.pending)}
      ${card('Saldo', rupiah(data.user.balance_cents))}
      ${card('Total chat', data.blast.chats)}
    </div>
    <div class="card mt-4">
      <h2 class="mb-3 text-sm font-medium">Kecepatan Blast</h2>
      <div class="flex flex-col gap-3 md:flex-row md:items-end">
        <label class="grid flex-1 gap-1 text-sm">Mode
          <select id="speed" class="input">${speedOptions(data.blast.speedMode, data.superBrutalReady)}</select>
        </label>
        <button id="save-speed" class="btn-ghost" type="button">Simpan Kecepatan</button>
      </div>
      <p id="speed-msg" class="mt-2 hidden text-sm"></p>
    </div>
    <div class="card mt-4">
      ${running
        ? '<button id="toggle" class="btn-danger">Stop blast</button>'
        : '<button id="toggle" class="btn-primary">Start Blast</button>'}
      <p class="mt-3 text-sm text-slate-400">
        Status: ${running ? 'berjalan' : 'berhenti'}
        · Super Brutal: ${data.superBrutalReady ? 'siap' : 'butuh 4 perangkat online nomor yang sama'}
      </p>
      <p id="page-error" class="mt-2 hidden text-sm text-red-400"></p>
    </div>
    ${liveLogsCard(data.logs, 'Log blast live')}
  `
  document.getElementById('save-speed').addEventListener('click', async () => {
    try {
      await api('/api/worker/blast/speed', {
        method: 'PUT',
        body: JSON.stringify({ speedMode: document.getElementById('speed').value })
      })
      notify('Kecepatan tersimpan', 'success')
    } catch (error) {
      setError(error.message)
    }
  })
  document.getElementById('toggle').addEventListener('click', async () => {
    try {
      if (running) {
        await api('/api/worker/blast/stop', { method: 'POST' })
      } else {
        const hasDevice = (data.devices || []).some((item) => item.status === 'online')
        if (!hasDevice) {
          notify('Tidak ada perangkat aktif. Silakan hubungkan perangkat terlebih dahulu.', 'error')
          return
        }
        await api('/api/worker/blast/start', { method: 'POST', body: JSON.stringify({}) })
      }
      loadPage()
    } catch (error) {
      setError(error.message)
    }
  })
}

const renderWorkerBlastHistory = async () => {
  const data = await api('/api/worker/blast-history')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// worker.history</div><h1 class="wb-page-title">BLAST HISTORY</h1><p class="wb-page-sub">Riwayat start, stop, pesan berhasil, pesan gagal, dan auto-stop.</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${card('Sesi blast', data.summary.starts)}
      ${card('Success', data.summary.success)}
      ${card('Failed', data.summary.failed)}
      ${card('Stop', data.summary.stops)}
    </div>
    <div class="card mt-4"><div class="monitor-live-logs wb-scroll-70">${(data.logs || []).map(monitorLogRow).join('') || '<div class="monitor-empty">Belum ada histori blast.</div>'}</div></div>
  `
}

const renderDevices = async () => {
  pairingDeviceId = null
  const data = await api('/api/worker/devices')
  view.innerHTML = `
    <div class="wb-page-head"><div class="wb-page-kicker">// worker.devices</div><h1 class="wb-page-title">WHATSAPP DEVICES</h1><p class="wb-page-sub">Hubungkan nomor via QR atau pairing code. Sesi aktif akan muncul realtime di bawah.</p></div>
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button id="add-device" class="btn-primary" type="button">Tambah perangkat</button>
    </div>
    <p class="mb-4 text-sm text-slate-400">
      Logout dari web tidak menghapus sesi. Pairing ulang hanya jika nomor logout dari HP.
      Super Brutal: <span id="super-brutal-label">${data.superBrutalReady ? 'siap' : 'belum 4 sesi nomor yang sama'}</span>
    </p>
    <p id="page-error" class="mb-3 hidden text-sm text-red-400"></p>
    <div id="device-list" class="grid gap-4 lg:grid-cols-2">
      ${data.devices.filter(showDeviceCard).map(deviceCardHtml).join('') || '<div id="device-empty" class="card text-slate-400">Belum ada perangkat</div>'}
    </div>
    <div id="pair-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/60 p-4">
      <div class="card w-full max-w-md">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-semibold">Tambah perangkat</h2>
          <button id="pair-close" class="btn-ghost" type="button">Tutup</button>
        </div>
        <p id="pair-hint" class="mb-3 text-sm text-slate-400">Pilih cara pairing nomor WhatsApp.</p>
        <div id="pair-methods" class="mb-4 grid gap-2 sm:grid-cols-2">
          <button id="pair-qr" class="btn-primary" type="button">QR</button>
          <button id="pair-code-toggle" class="btn-ghost" type="button">Kode Pairing</button>
        </div>
        <form id="pair-code-form" class="hidden space-y-3">
          <label class="grid gap-1 text-sm">Nomor WhatsApp
            <input class="input" name="phone" placeholder="628xxxxxxxxxx atau 08..." required />
          </label>
          <p class="text-xs text-slate-500">Masukkan nomor HP, lalu ketik kode 8 digit di WhatsApp → Perangkat tertaut.</p>
          <button class="btn-primary" type="submit">Mulai pairing code</button>
        </form>
        <div id="pair-live" class="hidden space-y-3">
          <img id="pair-qr-img" class="mx-auto hidden w-48 rounded bg-white p-2" alt="QR pairing" />
          <p id="pair-code-text" class="hidden text-center font-mono text-2xl tracking-widest"></p>
          <p id="pair-live-msg" class="text-sm text-slate-400">Menunggu pairing...</p>
        </div>
        <p id="pair-error" class="mt-3 hidden text-sm text-red-400"></p>
      </div>
    </div>
  `
  bindDevicePage()
}

const showDeviceCard = (device) => device?.status === 'online' && device.ready !== false

const deviceEmptyHtml = '<div id="device-empty" class="card text-slate-400">Belum ada perangkat</div>'

const syncDeviceEmpty = (list) => {
  if (list.querySelector('[data-device]')) {
    document.getElementById('device-empty')?.remove()
    return
  }
  if (!document.getElementById('device-empty')) list.insertAdjacentHTML('beforeend', deviceEmptyHtml)
}

const deviceCardHtml = (device) => `
  <div class="card" data-device="${device.id}">
    <div class="flex items-center justify-between">
      <p class="font-medium">Perangkat #${device.id}</p>
      ${statusBadge(device.status, device.status === 'online')}
    </div>
    <p class="mt-2 text-sm text-slate-400" data-device-meta>
      Nomor: <span data-phone>${device.phone || '-'}</span> · ${device.pairing_method === 'code' ? 'kode pairing' : (device.pairing_method || '-')}
    </p>
  </div>
`

const setPairError = (message) => {
  const el = document.getElementById('pair-error')
  if (el) {
    el.textContent = message || ''
    el.classList.toggle('hidden', !message)
  }
  notify(message)
}

const resetPairingUi = () => {
  pairingDeviceId = null
  document.getElementById('pair-methods')?.classList.remove('hidden')
  document.getElementById('pair-hint')?.classList.remove('hidden')
  document.getElementById('pair-code-form')?.classList.add('hidden')
  document.getElementById('pair-live')?.classList.add('hidden')
  const img = document.getElementById('pair-qr-img')
  if (img) {
    img.src = ''
    img.classList.add('hidden')
  }
  const code = document.getElementById('pair-code-text')
  if (code) {
    code.textContent = ''
    code.classList.add('hidden')
  }
  const msg = document.getElementById('pair-live-msg')
  if (msg) {
    msg.textContent = 'Menunggu pairing...'
    msg.classList.remove('text-emerald-400')
    msg.classList.add('text-slate-400')
  }
  setPairError('')
}

const showPairingLive = ({ qr, pairingCode, message, success = false }) => {
  document.getElementById('pair-methods')?.classList.add('hidden')
  document.getElementById('pair-hint')?.classList.add('hidden')
  document.getElementById('pair-code-form')?.classList.add('hidden')
  document.getElementById('pair-live')?.classList.remove('hidden')
  const img = document.getElementById('pair-qr-img')
  if (img) {
    img.src = qr || ''
    img.classList.toggle('hidden', !qr)
  }
  const code = document.getElementById('pair-code-text')
  if (code) {
    code.textContent = pairingCode || ''
    code.classList.toggle('hidden', !pairingCode)
  }
  const msg = document.getElementById('pair-live-msg')
  if (msg) {
    msg.textContent = message || (success ? 'Perangkat terhubung' : 'Menunggu pairing...')
    msg.classList.toggle('text-emerald-400', success)
    msg.classList.toggle('text-slate-400', !success)
  }
}

const applyPairingEvent = (device) => {
  if (device?.id == null || Number(device.id) !== Number(pairingDeviceId)) return
  if (device.status === 'online') {
    showPairingLive({ success: true, message: 'Perangkat terhubung' })
    pairingDeviceId = null
    setTimeout(() => {
      if (document.getElementById('pair-modal') && pairingDeviceId == null) setPairModalOpen(false)
    }, 800)
    return
  }
  if (device.qr || device.pairingCode) {
    showPairingLive({
      qr: device.qr,
      pairingCode: device.pairingCode,
      message: device.pairingCode ? 'Masukkan kode ini di WhatsApp' : 'Scan QR di WhatsApp'
    })
  }
}

const setPairModalOpen = (open) => {
  const modal = document.getElementById('pair-modal')
  if (!modal) return
  if (!open) resetPairingUi()
  modal.classList.toggle('hidden', !open)
  modal.classList.toggle('flex', open)
}

const bindDevicePage = () => {
  document.getElementById('add-device')?.addEventListener('click', () => {
    resetPairingUi()
    setPairModalOpen(true)
  })
  document.getElementById('pair-close')?.addEventListener('click', () => setPairModalOpen(false))
  document.getElementById('pair-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'pair-modal') setPairModalOpen(false)
  })
  document.getElementById('pair-qr')?.addEventListener('click', async () => {
    setPairError('')
    showPairingLive({ message: 'Menyiapkan QR...' })
    try {
      const { device } = await api('/api/worker/devices', {
        method: 'POST',
        body: JSON.stringify({ method: 'qr' })
      })
      pairingDeviceId = device.id
      showPairingLive({
        qr: device.qr,
        message: device.qr ? 'Scan QR di WhatsApp' : 'Menunggu QR...'
      })
    } catch (error) {
      resetPairingUi()
      setPairError(error.message)
    }
  })
  document.getElementById('pair-code-toggle')?.addEventListener('click', () => {
    setPairError('')
    document.getElementById('pair-code-form')?.classList.remove('hidden')
  })
  document.getElementById('pair-code-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const phone = new FormData(event.target).get('phone')
    setPairError('')
    showPairingLive({ message: 'Meminta kode pairing...' })
    try {
      const { device } = await api('/api/worker/devices', {
        method: 'POST',
        body: JSON.stringify({ method: 'code', phone })
      })
      pairingDeviceId = device.id
      showPairingLive({
        pairingCode: device.pairingCode,
        message: device.pairingCode ? 'Masukkan kode ini di WhatsApp' : 'Menunggu kode...'
      })
    } catch (error) {
      resetPairingUi()
      document.getElementById('pair-code-form')?.classList.remove('hidden')
      setPairError(error.message)
    }
  })
}

const patchDeviceCard = (device) => {
  const list = document.getElementById('device-list')
  if (!list || device?.id == null) return false
  let card = list.querySelector(`[data-device="${device.id}"]`)
  if (!showDeviceCard(device)) {
    card?.remove()
    syncDeviceEmpty(list)
    return false
  }
  if (!card) {
    document.getElementById('device-empty')?.remove()
    list.insertAdjacentHTML('afterbegin', deviceCardHtml(device))
    return true
  }
  const badge = card.querySelector('[data-status]')
  if (badge) badge.outerHTML = statusBadge(device.status, true)
  const phone = card.querySelector('[data-phone]')
  if (phone && device.phone !== undefined) phone.textContent = device.phone || '-'
  return true
}

const copyToClipboard = async (value) => {
  const text = String(value || '')
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const ok = document.execCommand('copy')
    input.remove()
    return ok
  }
}

const formatJoinedDate = (value) => {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

const renderNetwork = async (prefix) => {
  const data = await api(`/api/${prefix}/network`)
  const link = referralLink(data.referralCode)
  const members = Array.isArray(data.members) ? data.members : []
  const onlineCount = members.filter((item) => item.wa_status === 'online').length
  const totalBlast = members.reduce((sum, item) => sum + Number(item.total_blast || 0), 0)

  view.innerHTML = `
    <div class="wb-page-head">
      <div class="wb-page-kicker">// ${prefix}.network</div>
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="wb-page-title">MY REFERRAL NETWORK</h1>
          <p class="wb-page-sub">Bangun jaringan kamu, bagikan link referral, dan pantau koneksi WhatsApp serta aktivitas blast anggota secara cepat.</p>
        </div>
        <div class="wb-network-live"><span></span>${onlineCount} WA ONLINE</div>
      </div>
    </div>

    <section class="wb-referral-hero">
      <div class="wb-referral-grid">
        <div>
          <div class="wb-page-kicker">REFERRAL LINK</div>
          <div class="wb-referral-code">${escapeHtml(data.referralCode || '-')}</div>
          <p class="wb-referral-copy">Ajak anggota baru menggunakan link ini untuk masuk ke jaringan kamu.</p>
        </div>
        <div class="wb-referral-actions">
          <div class="wb-referral-linkbox">
            <span>${escapeHtml(link)}</span>
          </div>
          <button id="copy-referral-link" type="button" class="btn-primary">⧉ Salin Link Referral</button>
        </div>
      </div>
      <div class="wb-referral-meta">
        <span><strong>${members.length}</strong> anggota</span>
        <span><strong>${onlineCount}</strong> online</span>
        <span><strong>${totalBlast.toLocaleString('id-ID')}</strong> total blast</span>
      </div>
    </section>

    <section class="card mt-5">
      <div class="wb-section-bar">
        <div>
          <div class="wb-page-kicker">NETWORK MEMBERS</div>
          <h2 class="mt-1 text-lg font-black">${prefix === 'admin' ? 'WORKER DI BAWAH REFERRAL ADMIN' : 'WORKER DI BAWAH REFERRAL KAMU'}</h2>
        </div>
        <span class="wb-network-chip">${members.length} MEMBER</span>
      </div>
      ${table(
        prefix === 'admin'
          ? ['Worker', 'Diundang oleh', 'Tanggal bergabung', 'Status WA', 'Total blast']
          : ['Worker', 'Tanggal bergabung', 'Status WA', 'Total blast'],
        members.map((item) => prefix === 'admin'
          ? `<tr>
              <td><div class="wb-member-cell"><span class="wb-member-avatar">${escapeHtml(String(item.username || '?').slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(item.username)}</strong><small>#${escapeHtml(item.id)}</small></span></div></td>
              <td>${escapeHtml(item.invited_by || 'Admin')}</td>
              <td><span class="font-mono text-xs text-slate-400">${escapeHtml(formatJoinedDate(item.created_at))}</span></td>
              <td>${statusBadge(item.wa_status || 'offline', item.wa_status === 'online')}</td>
              <td><span class="wb-blast-total">${Number(item.total_blast || 0).toLocaleString('id-ID')}</span></td>
            </tr>`
          : `<tr>
              <td><div class="wb-member-cell"><span class="wb-member-avatar">${escapeHtml(String(item.username || '?').slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(item.username)}</strong><small>#${escapeHtml(item.id)}</small></span></div></td>
              <td><span class="font-mono text-xs text-slate-400">${escapeHtml(formatJoinedDate(item.created_at))}</span></td>
              <td>${statusBadge(item.wa_status || 'offline', item.wa_status === 'online')}</td>
              <td><span class="wb-blast-total">${Number(item.total_blast || 0).toLocaleString('id-ID')}</span></td>
            </tr>`
        ).join('') || `<tr><td class="px-3 py-6 text-center text-slate-500" colspan="${prefix === 'admin' ? 5 : 4}">Belum ada anggota di jaringan referral.</td></tr>`
      )}
    </section>
  `

  document.getElementById('copy-referral-link')?.addEventListener('click', async () => {
    const copied = await copyToClipboard(link)
    notify(copied ? 'Link referral berhasil disalin' : 'Gagal menyalin link referral', copied ? 'success' : 'error')
  })
}

const loadPage = async () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  renderNav()
  try {
    if (currentUser.role === 'super_admin') {
      if (page === 'db-monitor') await renderSuperDbMonitor()
      else if (page === 'admins') await renderAdmins()
      else if (page === 'workers') await renderSuperWorkers()
      else if (page === 'audit') await renderAuditLogs()
      else if (page === 'health') await renderSystemHealth()
      else if (page === 'dbs') await renderDbs()
      else if (page === 'settings') await renderSettings()
      else if (page === 'withdrawals') await renderSuperWithdrawals()
      else await renderSuperDashboard()
    } else if (currentUser.role === 'admin') {
      if (page === 'monitor-jobs') await renderAdminMonitorJobs()
      else if (page === 'workers') await renderAdminWorkers()
      else if (page === 'network') await renderNetwork('admin')
      else if (page === 'activity') await renderAdminActivity()
      else if (page === 'withdraw') await renderRoleWithdraw('admin')
      else await renderAdminDashboard()
    } else {
      if (page === 'devices') {
        await renderDevices()
        pollTimer = setInterval(async () => {
          if (page !== 'devices') return
          try {
            const data = await api('/api/worker/devices')
            const label = document.getElementById('super-brutal-label')
            if (label) {
              label.textContent = data.superBrutalReady ? 'siap' : 'belum 4 sesi nomor yang sama'
            }
            const list = document.getElementById('device-list')
            const ids = new Set(data.devices.map((item) => String(item.id)))
            list?.querySelectorAll('[data-device]').forEach((card) => {
              if (!ids.has(card.dataset.device)) card.remove()
            })
            data.devices.forEach(patchDeviceCard)
            if (list) syncDeviceEmpty(list)
          } catch {
            // biarkan polling berikutnya
          }
        }, DEVICE_POLL_MS)
      } else if (page === 'network') await renderNetwork('worker')
      else if (page === 'blast-history') await renderWorkerBlastHistory()
      else if (page === 'withdraw') await renderRoleWithdraw('worker')
      else await renderWorkerDashboard()
    }
  } catch (error) {
    notify(error.message)
    view.innerHTML = `<p class="text-red-400">${error.message}</p>`
  }
}

const connectSocket = () => {
  if (!window.io) return
  socket = window.io({ auth: { token: getToken() } })
  socket.on('blast:stats', () => {
    if (page === 'dashboard') loadPage().catch(() => {})
    else if (page === 'monitor-jobs') scheduleAdminMonitorStatsRefresh()
    else if (page === 'db-monitor' || page === 'health' || page === 'blast-history') loadPage().catch(() => {})
  })

  socket.on('db:status', () => {
    if (page === 'monitor-jobs' || page === 'db-monitor' || page === 'dashboard') loadPage().catch(() => {})
  })

  socket.on('notification:new', (item) => {
    notifications = [item, ...notifications.filter((row) => Number(row.id) !== Number(item.id))].slice(0, 100)
    renderNotifications()
    notify(item.title, item.type === 'warning' ? 'error' : item.type === 'success' ? 'success' : 'info')
  })

  socket.on('account:status', (payload) => {
    if (payload?.isActive === false) {
      notify('Akun dinonaktifkan oleh Super Admin.', 'error')
      clearSession()
      setTimeout(() => { location.href = '/login.html' }, 500)
    }
  })

  socket.on('account:security', (payload) => {
    if (payload?.action === 'password_reset') {
      notify('Password akun direset. Silakan login kembali.', 'error')
      clearSession()
      setTimeout(() => { location.href = '/login.html' }, 500)
    }
  })
  socket.on('device:status', (device) => {
    if (page === 'devices') {
      applyPairingEvent(device)
      patchDeviceCard(device)
      return
    }
    if (page === 'dashboard' && (device.status === 'online' || device.status === 'offline')) {
      loadPage().catch(() => {})
    }
    if (page === 'network' && (currentUser?.role === 'admin' || currentUser?.role === 'worker')) {
      loadPage().catch(() => {})
    }
  })
  socket.on('blast:log', (item) => {
    prependLiveLog(item)
    if (page === 'monitor-jobs') prependMonitorLog(item)
  })
}

const boot = async () => {
  if (!getToken()) {
    location.href = '/login.html'
    return
  }
  const { user } = await api('/api/auth/me')
  currentUser = user
  document.body.classList.add(`role-${user.role}`)
  const allowed = new Set((menus[user.role] || []).map(([id]) => id))
  const hashPage = decodeURIComponent(location.hash.replace(/^#/, ''))
  if (hashPage && allowed.has(hashPage)) page = hashPage
  if (roleLabel) roleLabel.textContent = roleText[user.role] || user.role
  if (userLabel) userLabel.textContent = user.username
  const mobileToggle = document.getElementById('mobile-nav-toggle')
  const mobileClose = document.getElementById('mobile-nav-close')
  const mobileOverlay = document.getElementById('mobile-nav-overlay')
  mobileToggle?.addEventListener('click', () => setMobileNavOpen(true))
  mobileClose?.addEventListener('click', () => setMobileNavOpen(false))
  mobileOverlay?.addEventListener('click', () => setMobileNavOpen(false))
  window.addEventListener('resize', () => { if (window.innerWidth >= 768) setMobileNavOpen(false) })
  window.addEventListener('orientationchange', () => setTimeout(() => setMobileNavOpen(false), 50))
  setupGlobalTools()
  connectSocket()
  await loadPage()
}

const doLogout = () => {
  clearSession()
  location.href = '/login.html'
}

document.getElementById('logout')?.addEventListener('click', doLogout)
document.getElementById('mobile-logout')?.addEventListener('click', doLogout)

boot().catch(() => {
  location.href = '/login.html'
})
