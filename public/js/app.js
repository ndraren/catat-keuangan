/**
 * Personal Expense Tracker - CatatKeuangan
 * Main Application Frontend Logic
 */

// ============================================================================
// State Management
// ============================================================================
let currentUser = null;
let currentPage = 'dashboard';
let categories = {
    income: [],
    expense: []
};
let charts = {
    incomeExpense: null,
    category: null,
    report: null,
    reportCategory: null
};
let historyPage = 1;
const ITEMS_PER_PAGE = 10;
let currentReportType = 'daily';
let currentCategoryTab = 'expense';
let pendingDeleteAction = null;

// ============================================================================
// API Helper
// ============================================================================
async function api(url, options = {}) {
    const config = {
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        ...options
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        config.body = JSON.stringify(options.body);
    }
    if (options.body instanceof FormData) {
        delete config.headers['Content-Type'];
        config.body = options.body;
    }

    try {
        const res = await fetch(url, config);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.error || `HTTP error ${res.status}`);
        }
        return data;
    } catch (err) {
        throw err;
    }
}

// ============================================================================
// Formatters & Utilities
// ============================================================================
function formatRupiah(amount) {
    const num = Number(amount) || 0;
    const formatted = Math.abs(num).toLocaleString('id-ID');
    return (num < 0 ? '-Rp' : 'Rp') + formatted;
}

function cleanAmount(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let str = String(val).trim().replace(/^Rp\s?/i, '');
    // Di Indonesia, titik adalah pemisah ribuan (e.g. 50.000 -> 50000)
    str = str.replace(/\./g, '');
    // Koma diganti titik untuk desimal bila ada
    str = str.replace(/,/g, '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

function formatNumberDisplay(num) {
    if (!num && num !== 0) return '';
    const clean = Math.round(Number(num));
    return isNaN(clean) ? '' : clean.toLocaleString('id-ID');
}

function setupCurrencyInputs() {
    document.querySelectorAll('.currency-input').forEach(input => {
        if (input.dataset.boundCurrency) return;
        input.dataset.boundCurrency = 'true';
        input.addEventListener('input', () => {
            const cursor = input.selectionStart;
            const prevLen = input.value.length;
            const cleanDigits = input.value.replace(/\D/g, '');
            if (!cleanDigits) {
                input.value = '';
                return;
            }
            const formatted = parseInt(cleanDigits, 10).toLocaleString('id-ID');
            input.value = formatted;
            const newLen = formatted.length;
            const newPos = Math.max(0, cursor + (newLen - prevLen));
            input.setSelectionRange(newPos, newPos);
        });
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    let d;
    if (parts.length === 3) {
        d = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
        d = new Date(dateStr);
    }
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getTodayStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getCurrentMonthStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getCurrentYearNum() {
    return new Date().getFullYear();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================================
// Toast Notification
// ============================================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    if (type === 'info') icon = 'info-circle';

    toast.innerHTML = `
        <div class="toast-content" style="display:flex;align-items:center;gap:10px;">
            <i class="fas fa-${icon}"></i>
            <span>${escapeHtml(message)}</span>
        </div>
        <button class="toast-close" style="background:none;border:none;color:inherit;cursor:pointer;padding:0 4px;" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 20);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============================================================================
// Modal Helpers
// ============================================================================
function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('active');
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
}

// Global modal close on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ============================================================================
// Navigation System
// ============================================================================
function navigateTo(page) {
    const pages = ['dashboard', 'transaction', 'history', 'budget', 'reports', 'savings', 'settings'];
    if (!pages.includes(page)) page = 'dashboard';

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(`page-${page}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
        if (item.getAttribute('data-page') === page) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update active mobile bottom nav button
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        if (btn.getAttribute('data-page') === page) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const titles = {
        dashboard: 'Dashboard',
        transaction: 'Catat Transaksi',
        history: 'Riwayat Transaksi',
        budget: 'Anggaran',
        reports: 'Laporan Keuangan',
        savings: 'Target Tabungan',
        settings: 'Pengaturan'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[page] || 'Dashboard';

    currentPage = page;

    // Close mobile sidebar
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) sidebarOverlay.classList.remove('active');

    // Load data for the active view
    loadPageData(page);
}

function loadPageData(page) {
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'transaction':
            loadTransactionForm();
            break;
        case 'history':
            historyPage = 1;
            loadHistory();
            break;
        case 'budget':
            loadBudgets();
            break;
        case 'reports':
            loadReport();
            break;
        case 'savings':
            loadSavings();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// ============================================================================
// Initialization & Authentication
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await api('/api/auth/me');
        currentUser = res.user;
        updateUserUI();
    } catch (e) {
        window.location.href = '/';
        return;
    }

    // Set today date display
    const dateEl = document.getElementById('currentDate');
    if (dateEl) dateEl.textContent = formatDateFull(getTodayStr());

    // Apply saved theme
    if (currentUser.theme === 'dark') {
        document.body.classList.add('dark-theme');
    }

    // Load initial categories
    await loadCategories();

    // Setup sidebar navigation links
    document.querySelectorAll('.sidebar-nav .nav-item[data-page]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            navigateTo(page);
        });
    });

    // Setup mobile bottom nav buttons
    document.querySelectorAll('.mobile-nav-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const page = btn.getAttribute('data-page');
            navigateTo(page);
        });
    });

    // Sidebar Controls: Toggle, Close, and Overlay
    const sidebar = document.getElementById('sidebar');
    const appContainer = document.querySelector('.app-container');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function toggleSidebar() {
        if (window.innerWidth <= 860) {
            const isOpen = sidebar.classList.toggle('open');
            if (sidebarOverlay) {
                sidebarOverlay.classList.toggle('active', isOpen);
            }
        } else {
            if (appContainer) {
                appContainer.classList.toggle('sidebar-collapsed');
            }
        }
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        if (window.innerWidth > 860 && appContainer) {
            appContainer.classList.add('sidebar-collapsed');
        }
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', toggleSidebar);
    }
    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', closeSidebar);
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Logout Action with Confirmation Modal
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('confirmLogoutModal');
        });
    }

    const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
    if (confirmLogoutBtn) {
        confirmLogoutBtn.addEventListener('click', async () => {
            confirmLogoutBtn.disabled = true;
            confirmLogoutBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengeluarkan...';
            try {
                await api('/api/auth/logout', { method: 'POST' });
            } catch (err) {
                // ignore
            }
            document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            window.location.replace('/');
        });
    }

    // Setup Transaction page tabs & form
    setupTransactionPage();

    // Setup Budget page controls
    const budgetMonthInput = document.getElementById('budgetMonth');
    if (budgetMonthInput) {
        budgetMonthInput.value = getCurrentMonthStr();
        budgetMonthInput.addEventListener('change', () => loadBudgets());
    }

    // Setup Reports page controls
    setupReportsPage();

    // Setup Settings listeners
    setupSettingsPage();

    // Setup Currency Live Input Formatter
    setupCurrencyInputs();

    // Load initial dashboard
    loadDashboard();
});

function updateUserUI() {
    if (!currentUser) return;
    const nameEl = document.getElementById('sidebarUserName');
    const emailEl = document.getElementById('sidebarUserEmail');
    if (nameEl) nameEl.textContent = currentUser.display_name || currentUser.username;
    if (emailEl) emailEl.textContent = currentUser.email;

    const avatarHtml = currentUser.profile_picture ?
        `<img src="${escapeHtml(currentUser.profile_picture)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` :
        `<i class="fas fa-user"></i>`;

    const sideAvatar = document.getElementById('sidebarAvatar');
    if (sideAvatar) sideAvatar.innerHTML = avatarHtml;

    const setAvatar = document.getElementById('settingsAvatar');
    if (setAvatar) setAvatar.innerHTML = avatarHtml;
}

// ============================================================================
// Categories Management
// ============================================================================
async function loadCategories() {
    try {
        const [incRes, expRes] = await Promise.all([
            api('/api/categories?type=income'),
            api('/api/categories?type=expense')
        ]);
        categories.income = incRes.categories || [];
        categories.expense = expRes.categories || [];
    } catch (e) {
        console.error('Failed to load categories', e);
    }
}

function populateCategorySelect(selectId, type, selectedId = null) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">Pilih kategori</option>';
    const list = categories[type] || [];
    list.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = `${cat.icon ? cat.icon + ' ' : ''}${cat.name}`;
        if (selectedId && Number(cat.id) === Number(selectedId)) {
            opt.selected = true;
        }
        sel.appendChild(opt);
    });
}

// ============================================================================
// 1. DASHBOARD
// ============================================================================
async function loadDashboard() {
    try {
        const summary = await api('/api/transactions/summary');

        // Total Saldo
        const balEl = document.getElementById('dashBalance');
        if (balEl) {
            balEl.textContent = formatRupiah(summary.balance);
            balEl.className = 'stat-value ' + (summary.balance >= 0 ? 'text-income' : 'text-expense');
        }

        // Pemasukan & Pengeluaran
        const incEl = document.getElementById('dashIncome');
        if (incEl) incEl.textContent = formatRupiah(summary.total_income);

        const expEl = document.getElementById('dashExpense');
        if (expEl) expEl.textContent = formatRupiah(summary.total_expense);

        // Hari Ini
        const todayExpEl = document.getElementById('dashTodayExpense');
        if (todayExpEl) todayExpEl.textContent = formatRupiah(summary.today_expense);

        // Minggu Ini & Bulan Ini
        const weekExpEl = document.getElementById('dashWeekExpense');
        if (weekExpEl) weekExpEl.textContent = formatRupiah(summary.this_week_expense);

        const monthExpEl = document.getElementById('dashMonthExpense');
        if (monthExpEl) monthExpEl.textContent = formatRupiah(summary.this_month_expense);

        // Sisa Anggaran Bulan Ini
        try {
            const bData = await api(`/api/budgets?month=${getCurrentMonthStr()}`);
            let rem = 0;
            if (bData.overall && bData.overall.remaining !== undefined) {
                rem = bData.overall.remaining;
            }
            const remEl = document.getElementById('dashBudgetRemaining');
            if (remEl) {
                remEl.textContent = formatRupiah(rem);
                remEl.className = 'mini-stat-value ' + (rem >= 0 ? 'text-income' : 'text-expense');
            }
        } catch (be) {
            const remEl = document.getElementById('dashBudgetRemaining');
            if (remEl) remEl.textContent = 'Rp0';
        }

        // Charts & Recent
        await loadDashboardCharts();
        await loadRecentTransactions();
    } catch (e) {
        showToast('Gagal memuat ringkasan dashboard: ' + e.message, 'error');
    }
}

async function loadDashboardCharts() {
    try {
        const currentYear = getCurrentYearNum();
        const res = await api(`/api/transactions/chart-data?year=${currentYear}`);
        const chartData = res.chart_data || [];

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const labels = chartData.map(d => {
            const m = parseInt(d.month.split('-')[1], 10);
            return monthNames[m - 1] || d.month;
        });
        const incomeValues = chartData.map(d => d.income);
        const expenseValues = chartData.map(d => d.expense);

        const ctx1 = document.getElementById('incomeExpenseChart');
        if (ctx1) {
            if (charts.incomeExpense) charts.incomeExpense.destroy();
            const c1 = ctx1.getContext('2d');

            // High-end fintech gradients
            const incGrad = c1.createLinearGradient(0, 0, 0, 300);
            incGrad.addColorStop(0, '#0ea5e9');
            incGrad.addColorStop(1, '#0284c7');

            const expGrad = c1.createLinearGradient(0, 0, 0, 300);
            expGrad.addColorStop(0, '#f43f5e');
            expGrad.addColorStop(1, '#e11d48');

            charts.incomeExpense = new Chart(c1, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Pemasukan',
                            data: incomeValues,
                            backgroundColor: incGrad,
                            borderRadius: 8,
                            borderSkipped: false,
                            maxBarThickness: 28
                        },
                        {
                            label: 'Pengeluaran',
                            data: expenseValues,
                            backgroundColor: expGrad,
                            borderRadius: 8,
                            borderSkipped: false,
                            maxBarThickness: 28
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            align: 'end',
                            labels: {
                                boxWidth: 10,
                                boxHeight: 10,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                font: { family: "'Work Sans', sans-serif", weight: '600', size: 12 }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(8, 15, 29, 0.95)',
                            titleFont: { family: "'Work Sans', sans-serif", size: 13, weight: '700' },
                            bodyFont: { family: "'Work Sans', sans-serif", size: 12 },
                            padding: 12,
                            cornerRadius: 10,
                            borderColor: 'rgba(56, 189, 248, 0.25)',
                            borderWidth: 1,
                            callbacks: {
                                label: (ctx) => `  ${ctx.dataset.label}: ${formatRupiah(ctx.raw)}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { font: { family: "'Work Sans', sans-serif", size: 11, weight: '600' } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(226, 232, 240, 0.6)' },
                            ticks: {
                                font: { family: "'Work Sans', sans-serif", size: 11 },
                                callback: (val) => formatRupiah(val)
                            }
                        }
                    }
                }
            });
        }

        // Category Doughnut (Fintech Precision Ring)
        const catRes = await api(`/api/transactions/category-summary?month=${getCurrentMonthStr()}`);
        const catData = catRes.category_summary || [];

        const ctx2 = document.getElementById('categoryChart');
        if (ctx2) {
            if (charts.category) charts.category.destroy();

            const palette = [
                '#0284c7', '#38bdf8', '#0ea5e9', '#6366f1', '#8b5cf6',
                '#10b981', '#f59e0b', '#f43f5e', '#ec4899', '#14b8a6'
            ];

            if (catData.length === 0) {
                charts.category = new Chart(ctx2.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: ['Belum Ada Pengeluaran'],
                        datasets: [{
                            data: [1],
                            backgroundColor: ['#e2e8f0']
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '72%',
                        plugins: {
                            tooltip: { enabled: false },
                            legend: { display: false }
                        }
                    }
                });
            } else {
                charts.category = new Chart(ctx2.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: catData.map(c => `${c.icon ? c.icon + ' ' : ''}${c.category_name}`),
                        datasets: [{
                            data: catData.map(c => c.total),
                            backgroundColor: palette.slice(0, catData.length),
                            borderWidth: 0,
                            borderRadius: 6,
                            spacing: 3
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '72%',
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    boxWidth: 10,
                                    boxHeight: 10,
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    font: { family: "'Work Sans', sans-serif", size: 11, weight: '500' }
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(8, 15, 29, 0.95)',
                                titleFont: { family: "'Work Sans', sans-serif", size: 13, weight: '700' },
                                bodyFont: { family: "'Work Sans', sans-serif", size: 12 },
                                padding: 12,
                                cornerRadius: 10,
                                borderColor: 'rgba(56, 189, 248, 0.25)',
                                borderWidth: 1,
                                callbacks: {
                                    label: (ctx) => `  ${ctx.label}: ${formatRupiah(ctx.raw)}`
                                }
                            }
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Failed to load dashboard charts', err);
    }
}

async function loadRecentTransactions() {
    const tbody = document.getElementById('recentTransactions');
    if (!tbody) return;

    try {
        const res = await api('/api/transactions/recent');
        const list = res.transactions || [];

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center" style="padding: 30px; color: var(--text-secondary);">
                        <i class="fas fa-receipt" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                        Belum ada transaksi yang dicatat.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = list.map(t => `
            <tr>
                <td>${formatDate(t.date)}</td>
                <td>
                    <div style="font-weight: 500;">${escapeHtml(t.name)}</div>
                    ${t.payment_method ? `<small style="color: var(--text-light);">${escapeHtml(t.payment_method)}</small>` : ''}
                </td>
                <td>
                    <span class="badge ${t.type}">
                        ${t.category_icon ? t.category_icon + ' ' : ''}${escapeHtml(t.category_name || '-')}
                    </span>
                </td>
                <td class="amount ${t.type}" style="font-weight: 600;">
                    ${t.type === 'income' ? '+' : '-'}${formatRupiah(t.amount)}
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Gagal memuat transaksi terbaru</td></tr>`;
    }
}

// ============================================================================
// 2. CATAT TRANSAKSI
// ============================================================================
function setupTransactionPage() {
    const tabExp = document.getElementById('tabExpense');
    const tabInc = document.getElementById('tabIncome');
    const txType = document.getElementById('txType');
    const pMethodGroup = document.getElementById('paymentMethodGroup');

    if (tabExp && tabInc) {
        tabExp.addEventListener('click', () => {
            tabExp.classList.add('active');
            tabInc.classList.remove('active');
            if (txType) txType.value = 'expense';
            if (pMethodGroup) pMethodGroup.style.display = 'block';
            populateCategorySelect('txCategory', 'expense');
        });

        tabInc.addEventListener('click', () => {
            tabInc.classList.add('active');
            tabExp.classList.remove('active');
            if (txType) txType.value = 'income';
            if (pMethodGroup) pMethodGroup.style.display = 'none';
            populateCategorySelect('txCategory', 'income');
        });
    }

    const txDate = document.getElementById('txDate');
    if (txDate && !txDate.value) txDate.value = getTodayStr();

    const form = document.getElementById('transactionForm');
    if (form) {
        form.addEventListener('submit', handleTransactionSubmit);
    }
}

function loadTransactionForm() {
    const txType = document.getElementById('txType');
    const type = (txType && txType.value) || 'expense';
    populateCategorySelect('txCategory', type);

    const txDate = document.getElementById('txDate');
    if (txDate && !txDate.value) txDate.value = getTodayStr();

    const pMethodGroup = document.getElementById('paymentMethodGroup');
    if (pMethodGroup) {
        pMethodGroup.style.display = type === 'expense' ? 'block' : 'none';
    }
}

async function handleTransactionSubmit(e) {
    e.preventDefault();

    const type = document.getElementById('txType').value;
    const name = document.getElementById('txName').value.trim();
    const amountVal = document.getElementById('txAmount').value;
    const category_id = document.getElementById('txCategory').value;
    const date = document.getElementById('txDate').value;
    const payment_method = type === 'expense' ? (document.getElementById('txPaymentMethod').value || '') : '';
    const notes = document.getElementById('txNotes').value.trim();

    const amount = cleanAmount(amountVal);

    if (!name) {
        showToast('Nama transaksi tidak boleh kosong', 'warning');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        showToast('Nominal transaksi harus lebih dari 0', 'warning');
        return;
    }
    if (!category_id) {
        showToast('Pilih kategori transaksi', 'warning');
        return;
    }
    if (!date) {
        showToast('Pilih tanggal transaksi', 'warning');
        return;
    }

    const btn = document.getElementById('txSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    }

    try {
        await api('/api/transactions', {
            method: 'POST',
            body: {
                type,
                name,
                amount,
                category_id: parseInt(category_id, 10),
                date,
                payment_method,
                notes
            }
        });

        showToast(`${type === 'income' ? 'Pemasukan' : 'Pengeluaran'} berhasil dicatat!`, 'success');

        // Reset inputs
        document.getElementById('txName').value = '';
        document.getElementById('txAmount').value = '';
        document.getElementById('txNotes').value = '';
        const pmSel = document.getElementById('txPaymentMethod');
        if (pmSel) pmSel.value = '';
        document.getElementById('txDate').value = getTodayStr();

        // Check if user budget exceeded
        if (type === 'expense') {
            checkBudgetAlert(category_id, date);
        }
    } catch (err) {
        showToast('Gagal menyimpan transaksi: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Simpan Transaksi';
        }
    }
}

async function checkBudgetAlert(categoryId, dateStr) {
    try {
        const month = dateStr.slice(0, 7);
        const bData = await api(`/api/budgets?month=${month}`);
        if (bData.budgets) {
            const catBudget = bData.budgets.find(b => Number(b.category_id) === Number(categoryId));
            if (catBudget && catBudget.amount > 0) {
                const pct = (catBudget.spent / catBudget.amount) * 100;
                if (pct >= 100) {
                    showToast(`⚠️ Peringatan: Anggaran "${catBudget.category_name}" telah terlampaui! (${pct.toFixed(0)}%)`, 'warning');
                } else if (pct >= 85) {
                    showToast(`⚠️ Peringatan: Pengeluaran "${catBudget.category_name}" mendekati batas anggaran (${pct.toFixed(0)}%)`, 'warning');
                }
            }
        }
    } catch (e) {
        // silent
    }
}

// ============================================================================
// 3. RIWAYAT TRANSAKSI
// ============================================================================
async function loadHistory() {
    const search = document.getElementById('histSearch') ? document.getElementById('histSearch').value.trim() : '';
    const type = document.getElementById('histType') ? document.getElementById('histType').value : '';
    const category_id = document.getElementById('histCategory') ? document.getElementById('histCategory').value : '';
    const date_from = document.getElementById('histDateFrom') ? document.getElementById('histDateFrom').value : '';
    const date_to = document.getElementById('histDateTo') ? document.getElementById('histDateTo').value : '';
    const month = document.getElementById('histMonth') ? document.getElementById('histMonth').value : '';

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (category_id) params.set('category_id', category_id);
    if (date_from) params.set('date_from', date_from);
    if (date_to) params.set('date_to', date_to);
    if (month) params.set('month', month);

    params.set('limit', ITEMS_PER_PAGE);
    params.set('offset', (historyPage - 1) * ITEMS_PER_PAGE);

    // Populate category filter dropdown if empty
    const histCatSel = document.getElementById('histCategory');
    if (histCatSel && histCatSel.options.length <= 1) {
        histCatSel.innerHTML = '<option value="">Semua Kategori</option>';
        const allCats = [...categories.expense, ...categories.income];
        allCats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.icon ? c.icon + ' ' : ''}${c.name} (${c.type === 'income' ? 'Masuk' : 'Keluar'})`;
            histCatSel.appendChild(opt);
        });
    }

    const tbody = document.getElementById('historyTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
    }

    try {
        const res = await api(`/api/transactions?${params.toString()}`);
        const list = res.transactions || [];
        const summary = res.summary || { total_income: 0, total_expense: 0 };

        // Update filtered summary cards
        const histInc = document.getElementById('histIncome');
        if (histInc) histInc.textContent = formatRupiah(summary.total_income);

        const histExp = document.getElementById('histExpense');
        if (histExp) histExp.textContent = formatRupiah(summary.total_expense);

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center" style="padding: 40px; color: var(--text-secondary);">
                        <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                        Tidak ada transaksi yang cocok dengan filter.
                    </td>
                </tr>`;
            renderPagination(0);
            return;
        }

        tbody.innerHTML = list.map(t => `
            <tr>
                <td>${formatDate(t.date)}</td>
                <td>
                    <div style="font-weight: 500;">${escapeHtml(t.name)}</div>
                    ${t.notes ? `<div style="font-size: 0.8rem; color: var(--text-light);">${escapeHtml(t.notes)}</div>` : ''}
                </td>
                <td>
                    <span class="badge ${t.type}">
                        ${t.category_icon ? t.category_icon + ' ' : ''}${escapeHtml(t.category_name || '-')}
                    </span>
                </td>
                <td>${escapeHtml(t.payment_method || '-')}</td>
                <td class="amount ${t.type}" style="font-weight: 600;">
                    ${t.type === 'income' ? '+' : '-'}${formatRupiah(t.amount)}
                </td>
                <td>
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-sm btn-outline btn-icon" onclick="openEditTransactionModal(${t.id})" title="Edit Transaksi">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger btn-icon" onclick="promptDeleteTransaction(${t.id}, '${escapeHtml(t.name)}')" title="Hapus Transaksi">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        const totalPages = Math.ceil((res.total || 0) / ITEMS_PER_PAGE);
        renderPagination(totalPages);
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Gagal memuat riwayat transaksi: ${escapeHtml(e.message)}</td></tr>`;
        }
    }
}

function renderPagination(totalPages) {
    const container = document.getElementById('historyPagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    if (historyPage > 1) {
        html += `<button class="page-btn" onclick="goToPage(${historyPage - 1})"><i class="fas fa-chevron-left"></i></button>`;
    }

    for (let i = 1; i <= totalPages; i++) {
        if (i === historyPage) {
            html += `<button class="page-btn active">${i}</button>`;
        } else if (Math.abs(i - historyPage) <= 2 || i === 1 || i === totalPages) {
            html += `<button class="page-btn" onclick="goToPage(${i})">${i}</button>`;
        } else if (Math.abs(i - historyPage) === 3) {
            html += `<span class="page-dots">...</span>`;
        }
    }

    if (historyPage < totalPages) {
        html += `<button class="page-btn" onclick="goToPage(${historyPage + 1})"><i class="fas fa-chevron-right"></i></button>`;
    }

    container.innerHTML = html;
}

function goToPage(page) {
    historyPage = page;
    loadHistory();
}

function resetHistoryFilters() {
    if (document.getElementById('histSearch')) document.getElementById('histSearch').value = '';
    if (document.getElementById('histType')) document.getElementById('histType').value = '';
    if (document.getElementById('histCategory')) document.getElementById('histCategory').value = '';
    if (document.getElementById('histDateFrom')) document.getElementById('histDateFrom').value = '';
    if (document.getElementById('histDateTo')) document.getElementById('histDateTo').value = '';
    if (document.getElementById('histMonth')) document.getElementById('histMonth').value = '';
    historyPage = 1;
    loadHistory();
}

// Edit Transaksi Modal
async function openEditTransactionModal(id) {
    try {
        const res = await api(`/api/transactions?limit=1000`);
        const tx = (res.transactions || []).find(t => Number(t.id) === Number(id));

        if (!tx) {
            showToast('Data transaksi tidak ditemukan', 'error');
            return;
        }

        document.getElementById('editTxId').value = tx.id;
        document.getElementById('editTxType').value = tx.type;
        document.getElementById('editTxName').value = tx.name;
        document.getElementById('editTxAmount').value = formatNumberDisplay(tx.amount);
        document.getElementById('editTxDate').value = tx.date;
        document.getElementById('editTxNotes').value = tx.notes || '';

        populateCategorySelect('editTxCategory', tx.type, tx.category_id);

        const pmGroup = document.getElementById('editPaymentMethodGroup');
        const pmSel = document.getElementById('editTxPaymentMethod');
        if (tx.type === 'expense') {
            if (pmGroup) pmGroup.style.display = 'block';
            if (pmSel) pmSel.value = tx.payment_method || '';
        } else {
            if (pmGroup) pmGroup.style.display = 'none';
        }

        openModal('editTransactionModal');
    } catch (e) {
        showToast('Gagal membuka modal edit: ' + e.message, 'error');
    }
}

async function saveEditTransaction() {
    const id = document.getElementById('editTxId').value;
    const type = document.getElementById('editTxType').value;
    const name = document.getElementById('editTxName').value.trim();
    const amountVal = document.getElementById('editTxAmount').value;
    const category_id = document.getElementById('editTxCategory').value;
    const date = document.getElementById('editTxDate').value;
    const payment_method = type === 'expense' ? (document.getElementById('editTxPaymentMethod').value || '') : '';
    const notes = document.getElementById('editTxNotes').value.trim();

    const amount = cleanAmount(amountVal);

    if (!name || isNaN(amount) || amount <= 0 || !category_id || !date) {
        showToast('Lengkapi semua data dengan benar', 'warning');
        return;
    }

    try {
        await api(`/api/transactions/${id}`, {
            method: 'PUT',
            body: {
                name,
                amount,
                category_id: parseInt(category_id, 10),
                date,
                payment_method,
                notes
            }
        });

        showToast('Transaksi berhasil diperbarui!');
        closeModal('editTransactionModal');
        loadHistory();
        if (currentPage === 'dashboard') loadDashboard();
    } catch (e) {
        showToast('Gagal memperbarui transaksi: ' + e.message, 'error');
    }
}

function promptDeleteTransaction(id, name) {
    document.getElementById('deleteMessage').textContent = `Apakah Anda yakin ingin menghapus transaksi "${name}"? Perhitungan saldo akan otomatis disesuaikan.`;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = async () => {
        try {
            await api(`/api/transactions/${id}`, { method: 'DELETE' });
            showToast('Transaksi berhasil dihapus');
            closeModal('confirmDeleteModal');
            loadHistory();
            if (currentPage === 'dashboard') loadDashboard();
        } catch (e) {
            showToast('Gagal menghapus transaksi: ' + e.message, 'error');
        }
    };
    openModal('confirmDeleteModal');
}

// ============================================================================
// 4. ANGGARAN (BUDGET)
// ============================================================================
async function loadBudgets() {
    const month = (document.getElementById('budgetMonth') && document.getElementById('budgetMonth').value) || getCurrentMonthStr();

    try {
        const data = await api(`/api/budgets?month=${month}`);

        const overall = data.overall || { budget: 0, spent: 0, remaining: 0 };
        const bTotal = document.getElementById('budgetTotal');
        const bSpent = document.getElementById('budgetSpent');
        const bRem = document.getElementById('budgetRemaining');

        if (bTotal) bTotal.textContent = formatRupiah(overall.budget);
        if (bSpent) bSpent.textContent = formatRupiah(overall.spent);
        if (bRem) {
            bRem.textContent = formatRupiah(overall.remaining);
            bRem.className = 'stat-value ' + (overall.remaining >= 0 ? 'text-income' : 'text-expense');
        }

        const list = data.budgets || [];
        const overallBudget = list.find(b => b.category_id === null || b.category_id === undefined);
        const categoryBudgets = list.filter(b => b.category_id !== null && b.category_id !== undefined);

        // Overall container
        const overallDiv = document.getElementById('overallBudget');
        if (overallDiv) {
            if (overallBudget) {
                const pct = overallBudget.amount > 0 ? (overallBudget.spent / overallBudget.amount) * 100 : 0;
                let statusClass = 'safe';
                if (pct > 90) statusClass = 'danger';
                else if (pct > 75) statusClass = 'warning';

                overallDiv.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-weight:600;font-size:1.05rem;">💼 Batas Pengeluaran Bulanan Keseluruhan</span>
                        <div style="display:flex;gap:6px;">
                            <button class="btn btn-sm btn-outline btn-icon" onclick="openEditBudgetModal(${overallBudget.id}, null, ${overallBudget.amount})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger btn-icon" onclick="promptDeleteBudget(${overallBudget.id}, 'Batas Bulanan')" title="Hapus">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.9rem;">
                        <span>Terpakai: <strong>${formatRupiah(overallBudget.spent)}</strong> / ${formatRupiah(overallBudget.amount)}</span>
                        <span>Sisa: <strong class="${overallBudget.remaining >= 0 ? 'text-income' : 'text-expense'}">${formatRupiah(overallBudget.remaining)}</strong></span>
                    </div>
                    <div class="progress-bar-container" style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;">
                        <div class="progress-bar ${statusClass}" style="width:${Math.min(pct, 100)}%;height:100%;transition:width 0.4s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:0.85rem;">
                        <span>Progress: <strong>${pct.toFixed(1)}%</strong></span>
                        ${pct >= 100 ? '<span class="text-danger" style="font-weight:600;"><i class="fas fa-exclamation-circle"></i> Anggaran Terlampaui!</span>' :
                          pct >= 75 ? '<span class="text-warning" style="font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Mendekati Batas</span>' :
                          '<span class="text-income"><i class="fas fa-check-circle"></i> Aman</span>'}
                    </div>
                `;
            } else {
                overallDiv.innerHTML = `
                    <p style="color:var(--text-secondary);margin:0;">
                        Belum ada batas pengeluaran bulanan keseluruhan untuk bulan ini.
                        <button class="btn btn-sm btn-primary" style="margin-left:8px;" onclick="showAddBudgetModal(true)">
                            <i class="fas fa-plus"></i> Atur Sekarang
                        </button>
                    </p>
                `;
            }
        }

        // Category budgets container
        const catContainer = document.getElementById('categoryBudgets');
        if (catContainer) {
            if (categoryBudgets.length === 0) {
                catContainer.innerHTML = `
                    <div style="text-align:center;padding:30px;color:var(--text-secondary);">
                        <i class="fas fa-chart-pie" style="font-size:2rem;margin-bottom:8px;display:block;opacity:0.5;"></i>
                        Belum ada anggaran per kategori untuk bulan ini.
                    </div>
                `;
            } else {
                catContainer.innerHTML = categoryBudgets.map(b => {
                    const pct = b.amount > 0 ? (b.spent / b.amount) * 100 : 0;
                    let statusClass = 'safe';
                    if (pct > 90) statusClass = 'danger';
                    else if (pct > 75) statusClass = 'warning';

                    return `
                        <div class="budget-item card" style="margin-bottom:14px;padding:16px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span style="font-size:1.2rem;">${b.category_icon || '📁'}</span>
                                    <span style="font-weight:600;font-size:1rem;">${escapeHtml(b.category_name)}</span>
                                </div>
                                <div style="display:flex;gap:6px;">
                                    <button class="btn btn-sm btn-outline btn-icon" onclick="openEditBudgetModal(${b.id}, ${b.category_id}, ${b.amount})" title="Edit">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn btn-sm btn-danger btn-icon" onclick="promptDeleteBudget(${b.id}, '${escapeHtml(b.category_name)}')" title="Hapus">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.9rem;">
                                <span>Terpakai: <strong>${formatRupiah(b.spent)}</strong> / ${formatRupiah(b.amount)}</span>
                                <span>Sisa: <strong class="${b.remaining >= 0 ? 'text-income' : 'text-expense'}">${formatRupiah(b.remaining)}</strong></span>
                            </div>
                            <div class="progress-bar-container" style="height:10px;background:var(--border);border-radius:5px;overflow:hidden;">
                                <div class="progress-bar ${statusClass}" style="width:${Math.min(pct, 100)}%;height:100%;"></div>
                            </div>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:0.85rem;">
                                <span>Progress: <strong>${pct.toFixed(1)}%</strong></span>
                                ${pct >= 100 ? '<span class="text-danger" style="font-weight:600;"><i class="fas fa-exclamation-circle"></i> Terlampaui!</span>' :
                                  pct >= 75 ? '<span class="text-warning" style="font-weight:600;"><i class="fas fa-exclamation-triangle"></i> Hampir Habis</span>' :
                                  '<span class="text-income"><i class="fas fa-check-circle"></i> Sesuai Rencana</span>'}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        showToast('Gagal memuat data anggaran: ' + e.message, 'error');
    }
}

function showAddBudgetModal(forceOverall = false) {
    document.getElementById('budgetModalTitle').textContent = 'Tambah Anggaran';
    document.getElementById('editBudgetId').value = '';
    document.getElementById('budgetAmount').value = '';

    const bTypeSel = document.getElementById('budgetType');
    bTypeSel.value = forceOverall ? 'overall' : 'category';
    toggleBudgetCategory();

    populateCategorySelect('budgetCategory', 'expense');
    openModal('editBudgetModal');
}

function toggleBudgetCategory() {
    const type = document.getElementById('budgetType').value;
    const catGroup = document.getElementById('budgetCategoryGroup');
    if (catGroup) {
        catGroup.classList.toggle('hidden', type === 'overall');
    }
}

function openEditBudgetModal(id, categoryId, amount) {
    document.getElementById('budgetModalTitle').textContent = 'Edit Anggaran';
    document.getElementById('editBudgetId').value = id;
    document.getElementById('budgetAmount').value = formatNumberDisplay(amount);

    const bTypeSel = document.getElementById('budgetType');
    if (categoryId) {
        bTypeSel.value = 'category';
        populateCategorySelect('budgetCategory', 'expense', categoryId);
    } else {
        bTypeSel.value = 'overall';
    }
    toggleBudgetCategory();
    openModal('editBudgetModal');
}

async function saveBudget() {
    const id = document.getElementById('editBudgetId').value;
    const type = document.getElementById('budgetType').value;
    const amountVal = document.getElementById('budgetAmount').value;
    const amount = cleanAmount(amountVal);
    const month = (document.getElementById('budgetMonth') && document.getElementById('budgetMonth').value) || getCurrentMonthStr();

    if (isNaN(amount) || amount <= 0) {
        showToast('Jumlah anggaran harus lebih dari 0', 'warning');
        return;
    }

    let category_id = null;
    if (type === 'category') {
        const catVal = document.getElementById('budgetCategory').value;
        if (!catVal) {
            showToast('Pilih kategori untuk anggaran ini', 'warning');
            return;
        }
        category_id = parseInt(catVal, 10);
    }

    try {
        if (id) {
            await api(`/api/budgets/${id}`, {
                method: 'PUT',
                body: { amount }
            });
        } else {
            await api('/api/budgets', {
                method: 'POST',
                body: { category_id, amount, month }
            });
        }

        showToast('Anggaran berhasil disimpan!');
        closeModal('editBudgetModal');
        loadBudgets();
    } catch (e) {
        showToast('Gagal menyimpan anggaran: ' + e.message, 'error');
    }
}

function promptDeleteBudget(id, name) {
    document.getElementById('deleteMessage').textContent = `Hapus pengaturan anggaran untuk "${name}"?`;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = async () => {
        try {
            await api(`/api/budgets/${id}`, { method: 'DELETE' });
            showToast('Anggaran berhasil dihapus');
            closeModal('confirmDeleteModal');
            loadBudgets();
        } catch (e) {
            showToast('Gagal menghapus anggaran: ' + e.message, 'error');
        }
    };
    openModal('confirmDeleteModal');
}

// ============================================================================
// 5. LAPORAN KEUANGAN
// ============================================================================
function setupReportsPage() {
    // Report Tabs
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentReportType = tab.getAttribute('data-report');
            updateReportFilters();
            loadReport();
        });
    });

    const rDate = document.getElementById('reportDate');
    if (rDate) {
        rDate.value = getTodayStr();
        rDate.addEventListener('change', () => loadReport());
    }

    const rMonth = document.getElementById('reportMonth');
    if (rMonth) {
        rMonth.value = getCurrentMonthStr();
        rMonth.addEventListener('change', () => loadReport());
    }

    const rYear = document.getElementById('reportYear');
    if (rYear) {
        rYear.innerHTML = '';
        const currentYear = getCurrentYearNum();
        for (let y = currentYear; y >= currentYear - 5; y--) {
            rYear.innerHTML += `<option value="${y}">${y}</option>`;
        }
        rYear.addEventListener('change', () => loadReport());
    }
}

function updateReportFilters() {
    const dFilter = document.getElementById('reportDateFilter');
    const mFilter = document.getElementById('reportMonthFilter');
    const yFilter = document.getElementById('reportYearFilter');

    if (dFilter) dFilter.classList.toggle('hidden', currentReportType !== 'daily' && currentReportType !== 'weekly');
    if (mFilter) mFilter.classList.toggle('hidden', currentReportType !== 'monthly');
    if (yFilter) yFilter.classList.toggle('hidden', currentReportType !== 'yearly');
}

async function loadReport() {
    let url = `/api/reports/${currentReportType}?`;
    switch (currentReportType) {
        case 'daily':
        case 'weekly': {
            const dt = document.getElementById('reportDate').value || getTodayStr();
            url += `date=${dt}`;
            break;
        }
        case 'monthly': {
            const m = document.getElementById('reportMonth').value || getCurrentMonthStr();
            url += `month=${m}`;
            break;
        }
        case 'yearly': {
            const y = document.getElementById('reportYear').value || getCurrentYearNum();
            url += `year=${y}`;
            break;
        }
    }

    try {
        const data = await api(url);

        // Summary Cards
        const rInc = document.getElementById('reportIncome');
        const rExp = document.getElementById('reportExpense');
        const rAvg = document.getElementById('reportAvgDaily');

        if (rInc) rInc.textContent = formatRupiah(data.total_income || 0);
        if (rExp) rExp.textContent = formatRupiah(data.total_expense || 0);
        if (rAvg) rAvg.textContent = formatRupiah(data.avg_daily || 0);

        renderReportTrendChart(data);
        renderReportCategoryChart(data);
        renderTopCategories(data);
        renderReportTable(data);
    } catch (e) {
        showToast('Gagal memuat laporan keuangan: ' + e.message, 'error');
    }
}

function renderReportTrendChart(data) {
    const ctx = document.getElementById('reportChart');
    if (!ctx) return;
    if (charts.report) charts.report.destroy();

    let labels = [];
    let incData = [];
    let expData = [];

    if (data.daily_breakdown && data.daily_breakdown.length > 0) {
        labels = data.daily_breakdown.map(d => formatDate(d.date));
        incData = data.daily_breakdown.map(d => d.income);
        expData = data.daily_breakdown.map(d => d.expense);
    } else if (data.monthly_breakdown && data.monthly_breakdown.length > 0) {
        const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        labels = data.monthly_breakdown.map(d => {
            const idx = parseInt(d.month.split('-')[1], 10);
            return mNames[idx - 1] || d.month;
        });
        incData = data.monthly_breakdown.map(d => d.income);
        expData = data.monthly_breakdown.map(d => d.expense);
    } else {
        labels = ['Ringkasan'];
        incData = [data.total_income || 0];
        expData = [data.total_expense || 0];
    }

    const cCtx = ctx.getContext('2d');
    const blueLineGrad = cCtx.createLinearGradient(0, 0, 0, 300);
    blueLineGrad.addColorStop(0, 'rgba(14, 165, 233, 0.28)');
    blueLineGrad.addColorStop(1, 'rgba(14, 165, 233, 0.0)');

    const redLineGrad = cCtx.createLinearGradient(0, 0, 0, 300);
    redLineGrad.addColorStop(0, 'rgba(244, 63, 94, 0.25)');
    redLineGrad.addColorStop(1, 'rgba(244, 63, 94, 0.0)');

    charts.report = new Chart(cCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Pemasukan',
                    data: incData,
                    borderColor: '#0ea5e9',
                    backgroundColor: blueLineGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#0ea5e9',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Pengeluaran',
                    data: expData,
                    borderColor: '#f43f5e',
                    backgroundColor: redLineGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#f43f5e',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: "'Work Sans', sans-serif", weight: '600', size: 12 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(8, 15, 29, 0.95)',
                    titleFont: { family: "'Work Sans', sans-serif", size: 13, weight: '700' },
                    bodyFont: { family: "'Work Sans', sans-serif", size: 12 },
                    padding: 12,
                    cornerRadius: 10,
                    borderColor: 'rgba(56, 189, 248, 0.25)',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `  ${ctx.dataset.label}: ${formatRupiah(ctx.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: "'Work Sans', sans-serif", size: 11, weight: '600' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(226, 232, 240, 0.6)' },
                    ticks: {
                        font: { family: "'Work Sans', sans-serif", size: 11 },
                        callback: (v) => formatRupiah(v)
                    }
                }
            }
        }
    });
}

function renderReportCategoryChart(data) {
    const ctx = document.getElementById('reportCategoryChart');
    if (!ctx) return;
    if (charts.reportCategory) charts.reportCategory.destroy();

    const catList = data.category_breakdown || [];
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16'];

    if (catList.length === 0) {
        charts.reportCategory = new Chart(ctx.getContext('2d'), {
            type: 'pie',
            data: {
                labels: ['Tidak ada data'],
                datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
        return;
    }

    charts.reportCategory = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: catList.map(c => `${c.icon ? c.icon + ' ' : ''}${c.category_name}`),
            datasets: [{
                data: catList.map(c => c.total),
                backgroundColor: colors.slice(0, catList.length),
                borderWidth: 0,
                borderRadius: 5,
                spacing: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: "'Work Sans', sans-serif", size: 11, weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(8, 15, 29, 0.95)',
                    titleFont: { family: "'Work Sans', sans-serif", size: 13, weight: '700' },
                    bodyFont: { family: "'Work Sans', sans-serif", size: 12 },
                    padding: 12,
                    cornerRadius: 10,
                    borderColor: 'rgba(56, 189, 248, 0.25)',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `  ${ctx.label}: ${formatRupiah(ctx.raw)}`
                    }
                }
            }
        }
    });
}

function renderTopCategories(data) {
    const container = document.getElementById('topCategories');
    if (!container) return;

    const list = [...(data.category_breakdown || [])].sort((a, b) => b.total - a.total);
    if (list.length === 0) {
        container.innerHTML = '<p class="empty-text" style="color:var(--text-secondary);padding:10px;">Tidak ada pengeluaran pada periode ini.</p>';
        return;
    }

    const maxVal = list[0].total || 1;

    container.innerHTML = list.map((c, i) => {
        const pct = ((c.total / maxVal) * 100).toFixed(1);
        return `
            <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:4px;">
                    <span><strong>#${i + 1}</strong> ${c.icon ? c.icon + ' ' : ''}${escapeHtml(c.category_name)}</span>
                    <span style="font-weight:600;color:var(--danger);">${formatRupiah(c.total)}</span>
                </div>
                <div class="progress-bar-container" style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
                    <div class="progress-bar danger" style="width:${pct}%;height:100%;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderReportTable(data) {
    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;

    const list = data.transactions || [];
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--text-secondary);">Tidak ada transaksi pada periode ini</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(t => `
        <tr>
            <td>${formatDate(t.date)}</td>
            <td>
                <div style="font-weight:500;">${escapeHtml(t.name)}</div>
                ${t.notes ? `<small style="color:var(--text-light);">${escapeHtml(t.notes)}</small>` : ''}
            </td>
            <td>
                <span class="badge ${t.type}">${t.category_icon ? t.category_icon + ' ' : ''}${escapeHtml(t.category_name || '-')}</span>
            </td>
            <td class="amount ${t.type}" style="font-weight:600;">
                ${t.type === 'income' ? '+' : '-'}${formatRupiah(t.amount)}
            </td>
        </tr>
    `).join('');
}

// PDF & Excel Export
async function exportPDF() {
    try {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            showToast('Library jsPDF belum selesai dimuat', 'error');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text('Laporan Keuangan Pribadi - CatatKeuangan', 14, 20);

        doc.setFontSize(10);
        doc.text(`Tipe Periode: ${currentReportType.toUpperCase()}`, 14, 28);
        doc.text(`Waktu Cetak: ${formatDateFull(getTodayStr())}`, 14, 34);

        const incText = document.getElementById('reportIncome') ? document.getElementById('reportIncome').textContent : 'Rp0';
        const expText = document.getElementById('reportExpense') ? document.getElementById('reportExpense').textContent : 'Rp0';
        const avgText = document.getElementById('reportAvgDaily') ? document.getElementById('reportAvgDaily').textContent : 'Rp0';

        doc.setFontSize(11);
        doc.text(`Total Pemasukan: ${incText}`, 14, 44);
        doc.text(`Total Pengeluaran: ${expText}`, 14, 50);
        doc.text(`Rata-rata Pengeluaran Harian: ${avgText}`, 14, 56);

        const rows = [];
        const tbody = document.getElementById('reportTableBody');
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(tr => {
                const cols = [];
                tr.querySelectorAll('td').forEach(td => cols.push(td.innerText.trim()));
                if (cols.length === 4 && cols[0] !== 'Tidak ada transaksi pada periode ini') {
                    rows.push(cols);
                }
            });
        }

        if (rows.length > 0 && doc.autoTable) {
            doc.autoTable({
                startY: 64,
                head: [['Tanggal', 'Nama Transaksi', 'Kategori', 'Jumlah']],
                body: rows,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [30, 58, 95] }
            });
        }

        doc.save(`Laporan-Keuangan-${currentReportType}-${getTodayStr()}.pdf`);
        showToast('Laporan PDF berhasil diunduh!');
    } catch (e) {
        showToast('Gagal ekspor PDF: ' + e.message, 'error');
    }
}

function exportExcel() {
    try {
        if (!window.XLSX) {
            showToast('Library XLSX belum selesai dimuat', 'error');
            return;
        }

        const rows = [
            ['LAPORAN KEUANGAN PRIBADI - CATATKEUANGAN'],
            [`Periode: ${currentReportType.toUpperCase()}`],
            [`Tanggal Ekspor: ${getTodayStr()}`],
            [''],
            ['Tanggal', 'Nama Transaksi', 'Kategori', 'Jumlah']
        ];

        const tbody = document.getElementById('reportTableBody');
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(tr => {
                const cols = [];
                tr.querySelectorAll('td').forEach(td => cols.push(td.innerText.trim()));
                if (cols.length === 4 && cols[0] !== 'Tidak ada transaksi pada periode ini') {
                    rows.push(cols);
                }
            });
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
        XLSX.writeFile(wb, `Laporan-Keuangan-${currentReportType}-${getTodayStr()}.xlsx`);
        showToast('Laporan Excel berhasil diunduh!');
    } catch (e) {
        showToast('Gagal ekspor Excel: ' + e.message, 'error');
    }
}

// ============================================================================
// 6. TARGET TABUNGAN (SAVINGS GOALS)
// ============================================================================
async function loadSavings() {
    const grid = document.getElementById('savingsGrid');
    const empty = document.getElementById('emptySavings');
    if (!grid) return;

    try {
        const res = await api('/api/savings');
        const list = res.savings_goals || [];

        // Remove old dynamic cards
        grid.querySelectorAll('.savings-card').forEach(el => el.remove());

        if (list.length === 0) {
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';

        list.forEach(g => {
            const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0;
            const remaining = Math.max(0, g.target_amount - g.current_amount);
            const isCompleted = pct >= 100;

            const card = document.createElement('div');
            card.className = 'savings-card card';
            card.style.cssText = 'padding:20px;display:flex;flex-direction:column;justify-content:space-between;';

            card.innerHTML = `
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                        <span style="font-size:2rem;">${g.icon || '🎯'}</span>
                        <div style="display:flex;gap:6px;">
                            <button class="btn btn-sm btn-outline btn-icon" onclick="openEditSavingsModal(${g.id}, '${escapeHtml(g.name)}', ${g.target_amount}, ${g.current_amount}, '${g.deadline || ''}', '${escapeHtml(g.icon || '🎯')}')" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger btn-icon" onclick="promptDeleteSavings(${g.id}, '${escapeHtml(g.name)}')" title="Hapus">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <h3 style="font-size:1.15rem;margin-bottom:12px;">${escapeHtml(g.name)}</h3>
                    
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:0.9rem;">
                        <div>
                            <span style="color:var(--text-secondary);display:block;font-size:0.8rem;">Terkumpul</span>
                            <span class="text-income" style="font-weight:700;font-size:1.05rem;">${formatRupiah(g.current_amount)}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="color:var(--text-secondary);display:block;font-size:0.8rem;">Target</span>
                            <span style="font-weight:700;font-size:1.05rem;">${formatRupiah(g.target_amount)}</span>
                        </div>
                    </div>

                    <div class="progress-bar-container" style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:8px;">
                        <div class="progress-bar ${isCompleted ? 'safe' : 'info'}" style="width:${Math.min(pct, 100)}%;height:100%;transition:width 0.4s ease;"></div>
                    </div>

                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">
                        <span>Pencapaian: <strong>${pct.toFixed(1)}%</strong></span>
                        <span>Sisa: <strong>${formatRupiah(remaining)}</strong></span>
                    </div>

                    ${g.deadline ? `
                        <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">
                            <i class="fas fa-calendar-alt"></i> Batas: ${formatDate(g.deadline)}
                        </div>
                    ` : ''}

                    ${isCompleted ? `
                        <div style="background:var(--success-light);color:var(--success-dark);padding:8px 12px;border-radius:8px;text-align:center;font-weight:600;margin-bottom:12px;">
                            <i class="fas fa-trophy"></i> Target Tercapai! 🎉
                        </div>
                    ` : ''}
                </div>

                <button class="btn btn-primary btn-sm" style="width:100%;" onclick="openAddSavingsAmountModal(${g.id}, '${escapeHtml(g.name)}', ${g.current_amount}, ${g.target_amount})">
                    <i class="fas fa-plus-circle"></i> Tambah Tabungan
                </button>
            `;

            grid.appendChild(card);
        });
    } catch (e) {
        showToast('Gagal memuat target tabungan: ' + e.message, 'error');
    }
}

function showAddSavingsModal() {
    document.getElementById('savingsModalTitle').textContent = 'Buat Target Tabungan';
    document.getElementById('editSavingsId').value = '';
    document.getElementById('savingsName').value = '';
    document.getElementById('savingsTarget').value = '';
    document.getElementById('savingsCurrent').value = '0';
    document.getElementById('savingsDeadline').value = '';
    document.getElementById('savingsIcon').value = '🎯';
    openModal('editSavingsModal');
}

function openEditSavingsModal(id, name, target, current, deadline, icon) {
    document.getElementById('savingsModalTitle').textContent = 'Edit Target Tabungan';
    document.getElementById('editSavingsId').value = id;
    document.getElementById('savingsName').value = name;
    document.getElementById('savingsTarget').value = formatNumberDisplay(target);
    document.getElementById('savingsCurrent').value = formatNumberDisplay(current);
    document.getElementById('savingsDeadline').value = deadline;
    document.getElementById('savingsIcon').value = icon;
    openModal('editSavingsModal');
}

async function saveSavingsGoal() {
    const id = document.getElementById('editSavingsId').value;
    const name = document.getElementById('savingsName').value.trim();
    const targetVal = document.getElementById('savingsTarget').value;
    const currentVal = document.getElementById('savingsCurrent').value;
    const deadline = document.getElementById('savingsDeadline').value || null;
    const icon = document.getElementById('savingsIcon').value.trim() || '🎯';

    const target_amount = cleanAmount(targetVal);
    const current_amount = cleanAmount(currentVal) || 0;

    if (!name) {
        showToast('Nama target tidak boleh kosong', 'warning');
        return;
    }
    if (isNaN(target_amount) || target_amount <= 0) {
        showToast('Jumlah target harus lebih dari 0', 'warning');
        return;
    }

    try {
        if (id) {
            await api(`/api/savings/${id}`, {
                method: 'PUT',
                body: { name, target_amount, current_amount, deadline, icon }
            });
        } else {
            await api('/api/savings', {
                method: 'POST',
                body: { name, target_amount, current_amount, deadline, icon }
            });
        }

        showToast('Target tabungan berhasil disimpan!');
        closeModal('editSavingsModal');
        loadSavings();
    } catch (e) {
        showToast('Gagal menyimpan target: ' + e.message, 'error');
    }
}

function openAddSavingsAmountModal(id, name, current, target) {
    document.getElementById('addSavingsId').value = id;
    document.getElementById('addSavingsInfo').innerHTML = `
        <strong>${escapeHtml(name)}</strong><br>
        Terkumpul saat ini: <strong>${formatRupiah(current)}</strong> dari target <strong>${formatRupiah(target)}</strong>
    `;
    document.getElementById('addSavingsAmount').value = '';
    openModal('addSavingsAmountModal');
}

async function addSavingsAmount() {
    const id = document.getElementById('addSavingsId').value;
    const amountVal = document.getElementById('addSavingsAmount').value;
    const amount = cleanAmount(amountVal);

    if (isNaN(amount) || amount <= 0) {
        showToast('Jumlah tabungan harus lebih dari 0', 'warning');
        return;
    }

    try {
        await api(`/api/savings/${id}/add`, {
            method: 'PUT',
            body: { amount }
        });
        showToast('Tabungan berhasil ditambahkan! Terus semangat menabung!');
        closeModal('addSavingsAmountModal');
        loadSavings();
    } catch (e) {
        showToast('Gagal menambahkan tabungan: ' + e.message, 'error');
    }
}

function promptDeleteSavings(id, name) {
    document.getElementById('deleteMessage').textContent = `Hapus target tabungan "${name}"?`;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = async () => {
        try {
            await api(`/api/savings/${id}`, { method: 'DELETE' });
            showToast('Target tabungan berhasil dihapus');
            closeModal('confirmDeleteModal');
            loadSavings();
        } catch (e) {
            showToast('Gagal menghapus target: ' + e.message, 'error');
        }
    };
    openModal('confirmDeleteModal');
}

// ============================================================================
// 7. PENGATURAN (SETTINGS)
// ============================================================================
function setupSettingsPage() {
    // Fill days 1-31
    const daySel = document.getElementById('settingsBudgetDay');
    if (daySel && daySel.options.length <= 1) {
        daySel.innerHTML = '';
        for (let i = 1; i <= 31; i++) {
            daySel.innerHTML += `<option value="${i}">Tanggal ${i}</option>`;
        }
    }

    // Theme toggles
    const tLight = document.getElementById('themeLightBtn');
    const tDark = document.getElementById('themeDarkBtn');

    if (tLight && tDark) {
        tLight.addEventListener('click', () => {
            tLight.classList.add('active');
            tDark.classList.remove('active');
            document.body.classList.remove('dark-theme');
        });

        tDark.addEventListener('click', () => {
            tDark.classList.add('active');
            tLight.classList.remove('active');
            document.body.classList.add('dark-theme');
        });
    }

    // File input change
    const picInput = document.getElementById('profilePicInput');
    if (picInput) {
        picInput.addEventListener('change', uploadProfilePicture);
    }
}

async function loadSettings() {
    if (!currentUser) return;

    const nameInput = document.getElementById('settingsName');
    if (nameInput) nameInput.value = currentUser.display_name || '';

    const curSel = document.getElementById('settingsCurrency');
    if (curSel) curSel.value = currentUser.currency || 'IDR';

    const daySel = document.getElementById('settingsBudgetDay');
    if (daySel) daySel.value = currentUser.budget_start_day || 1;

    const tLight = document.getElementById('themeLightBtn');
    const tDark = document.getElementById('themeDarkBtn');
    if (currentUser.theme === 'dark') {
        if (tDark) tDark.classList.add('active');
        if (tLight) tLight.classList.remove('active');
    } else {
        if (tLight) tLight.classList.add('active');
        if (tDark) tDark.classList.remove('active');
    }

    loadCategoryList();
}

async function saveProfile() {
    const nameInput = document.getElementById('settingsName');
    const display_name = nameInput ? nameInput.value.trim() : '';

    try {
        await api('/api/settings', {
            method: 'PUT',
            body: { display_name }
        });
        currentUser.display_name = display_name;
        updateUserUI();
        showToast('Profil pengguna berhasil diperbarui!');
    } catch (e) {
        showToast('Gagal menyimpan profil: ' + e.message, 'error');
    }
}

async function saveAppSettings() {
    const currency = document.getElementById('settingsCurrency').value;
    const budget_start_day = parseInt(document.getElementById('settingsBudgetDay').value, 10);
    const theme = document.getElementById('themeDarkBtn').classList.contains('active') ? 'dark' : 'light';

    try {
        await api('/api/settings', {
            method: 'PUT',
            body: { currency, budget_start_day, theme }
        });
        currentUser.currency = currency;
        currentUser.budget_start_day = budget_start_day;
        currentUser.theme = theme;
        showToast('Pengaturan aplikasi berhasil disimpan!');
    } catch (e) {
        showToast('Gagal menyimpan pengaturan: ' + e.message, 'error');
    }
}

async function uploadProfilePicture(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Pilih file gambar yang valid', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('profile_picture', file);

    try {
        showToast('Mengunggah foto profil...', 'info');
        const res = await api('/api/settings/profile-picture', {
            method: 'POST',
            body: formData
        });

        currentUser.profile_picture = res.url;
        updateUserUI();
        showToast('Foto profil berhasil diubah!');
    } catch (err) {
        showToast('Gagal mengunggah foto profil: ' + err.message, 'error');
    }
}

// Category Management Tab in Settings
function showCategoryType(type) {
    currentCategoryTab = type;
    const tExp = document.getElementById('catTabExpense');
    const tInc = document.getElementById('catTabIncome');

    if (type === 'expense') {
        if (tExp) tExp.classList.add('active');
        if (tInc) tInc.classList.remove('active');
    } else {
        if (tInc) tInc.classList.add('active');
        if (tExp) tExp.classList.remove('active');
    }

    const newTypeSel = document.getElementById('newCategoryType');
    if (newTypeSel) newTypeSel.value = type;

    loadCategoryList();
}

function loadCategoryList() {
    const container = document.getElementById('categoryList');
    if (!container) return;

    const list = categories[currentCategoryTab] || [];
    if (list.length === 0) {
        container.innerHTML = '<p class="empty-text" style="color:var(--text-secondary);padding:10px;">Belum ada kategori.</p>';
        return;
    }

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:10px;">
            ${list.map(c => `
                <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg);padding:10px 14px;border-radius:8px;border:1px solid var(--border);">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:1.2rem;">${c.icon || '📁'}</span>
                        <span style="font-weight:500;">${escapeHtml(c.name)}</span>
                    </div>
                    ${c.is_default ? `
                        <span style="font-size:0.75rem;background:var(--border);padding:2px 6px;border-radius:4px;color:var(--text-light);">Bawaan</span>
                    ` : `
                        <button class="btn btn-sm btn-danger btn-icon" onclick="promptDeleteCategory(${c.id}, '${escapeHtml(c.name)}')" title="Hapus">
                            <i class="fas fa-trash"></i>
                        </button>
                    `}
                </div>
            `).join('')}
        </div>
    `;
}

async function addCategory() {
    const nameInput = document.getElementById('newCategoryName');
    const iconInput = document.getElementById('newCategoryIcon');
    const typeSelect = document.getElementById('newCategoryType');

    const name = nameInput ? nameInput.value.trim() : '';
    const icon = (iconInput && iconInput.value.trim()) || '📁';
    const type = typeSelect ? typeSelect.value : currentCategoryTab;

    if (!name) {
        showToast('Nama kategori tidak boleh kosong', 'warning');
        return;
    }

    try {
        await api('/api/categories', {
            method: 'POST',
            body: { name, icon, type }
        });

        showToast('Kategori baru berhasil ditambahkan!');
        if (nameInput) nameInput.value = '';
        if (iconInput) iconInput.value = '';

        await loadCategories();
        loadCategoryList();
    } catch (e) {
        showToast('Gagal menambah kategori: ' + e.message, 'error');
    }
}

function promptDeleteCategory(id, name) {
    document.getElementById('deleteMessage').textContent = `Hapus kategori "${name}"? Kategori yang sudah memiliki riwayat transaksi tidak dapat dihapus.`;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = async () => {
        try {
            await api(`/api/categories/${id}`, { method: 'DELETE' });
            showToast('Kategori berhasil dihapus');
            closeModal('confirmDeleteModal');
            await loadCategories();
            loadCategoryList();
        } catch (e) {
            showToast('Gagal menghapus kategori: ' + e.message, 'error');
        }
    };
    openModal('confirmDeleteModal');
}

function confirmResetAllData() {
    const modalMsg = document.getElementById('deleteMessage');
    if (modalMsg) {
        modalMsg.innerHTML = '<span style="color:#ef4444; font-weight:700;">PERINGATAN:</span> Apakah Anda yakin ingin menghapus SEMUA catatan pemasukan dan pengeluaran? Saldo Anda akan kembali bersih menjadi Rp 0.';
    }
    const btn = document.getElementById('confirmDeleteBtn');
    if (btn) {
        btn.textContent = 'Ya, Reset Semua Data';
        btn.onclick = async () => {
            try {
                const res = await api('/api/settings/reset-data', { method: 'POST' });
                showToast(res.message || 'Semua transaksi berhasil direset ke Rp 0', 'success');
                closeModal('confirmDeleteModal');
                await loadDashboard();
                if (typeof loadTransactions === 'function') await loadTransactions();
            } catch (e) {
                showToast('Gagal mereset data: ' + e.message, 'error');
            }
        };
    }
    openModal('confirmDeleteModal');
}
