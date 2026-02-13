const api = new APIClient();
window.api = api;
let currentUserId = null;
let commandPollInterval = null;
let currentBrowserData = null; // Added for browser drill-down
let allUsersData = [];
let onlineUsersData = [];
window.currentLiveFeedMode = 'reset'; // Tracks what's currently shown in Live Feed

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadDashboard();

    // Auto-refresh stats/users every 10s
    setInterval(() => {
        if (document.visibilityState === 'visible') loadDashboard();
    }, 10000);

    document.getElementById('logoutBtn').addEventListener('click', () => api.logout());
    document.getElementById('refreshUsersBtn').addEventListener('click', loadDashboard);

    // Initial connection check
    checkServerConnection();
    // Re-check connection every 30s
    setInterval(checkServerConnection, 30000);

    const searchInput = document.getElementById('employeeSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderUserList(allUsersData, onlineUsersData, e.target.value);
        });
    }

    initCharts();
});

function initCharts() {
    // Pie Chart: Applications Usage
    const appsEl = document.getElementById('appsChart');
    if (appsEl) {
        const ctxPie = appsEl.getContext('2d');
        new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: ['Chrome', 'Word', 'Slack', 'Others'],
                datasets: [{
                    data: [45, 25, 20, 10],
                    backgroundColor: [
                        '#ef4444', // Red (Chrome)
                        '#8b5cf6', // Purple (Word)
                        '#3b82f6', // Blue (Slack)
                        '#1f2937'  // Dark (Others)
                    ],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { boxWidth: 10, font: { size: 10 } }
                    }
                },
                cutout: '70%'
            }
        });
    }

    // Bar Chart: Weekly Active Hours
    const hoursEl = document.getElementById('hoursChart');
    if (hoursEl) {
        const ctxBar = hoursEl.getContext('2d');
        new Chart(ctxBar, {
            type: 'bar',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                datasets: [{
                    label: 'Hours',
                    data: [6, 8, 7, 5, 8],
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { display: false }, ticks: { display: false } },
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

async function checkAuth() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    // Optional: Verify token validity with backend here if needed
}

async function loadDashboard() {
    const refreshBtn = document.getElementById('refreshUsersBtn');
    const refreshIcon = refreshBtn ? refreshBtn.querySelector('i') : null;

    // Start spin animation
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const [onlineData, allUsers] = await Promise.all([
            api.getOnlineUsers(),
            api.getAllUsers()
        ]);

        allUsersData = allUsers;
        onlineUsersData = onlineData.users;

        const searchInput = document.getElementById('employeeSearchInput');
        const filterText = searchInput ? searchInput.value : '';

        updateStats(onlineData.users.length, allUsers.length);
        renderUserList(allUsers, onlineData.users, filterText);

        // If a user is currently selected, refresh their specific details too
        if (currentUserId) {
            loadScreenshotCount(currentUserId);
            // Only auto-load screenshot if we are currently in image mode
            if (currentLiveFeedMode === 'image' || currentLiveFeedMode === 'reset') {
                loadLatestScreenshot(currentUserId);
            }
        }
    } catch (err) {
        console.error("Dashboard refresh failed", err);
    } finally {
        // Stop spin animation
        if (refreshIcon) {
            setTimeout(() => {
                refreshIcon.classList.remove('fa-spin');
            }, 500); // Minimum spin for visual feedback
        }
    }
}
function updateStats(onlineCount, totalCount) {
    const offlineCount = Math.max(0, totalCount - onlineCount);

    // Sidebar Stats
    const totalEl = document.getElementById('totalUserCount');
    if (totalEl) totalEl.textContent = totalCount;

    const onlineEl = document.getElementById('sidebarOnlineCount');
    if (onlineEl) onlineEl.textContent = onlineCount;

    const offlineEl = document.getElementById('sidebarOfflineCount');
    if (offlineEl) offlineEl.textContent = offlineCount;

    // Detail View Stats (if user selected)
    // Here we might fetch specific details later
}


function renderUserList(allUsers, onlineUsers, filterText = '') {
    const listContainer = document.getElementById('usersList');
    const onlineIds = new Set(onlineUsers.map(u => u.user_id));

    listContainer.innerHTML = '';

    const filteredUsers = allUsers.filter(user =>
        (user.name || '').toLowerCase().includes(filterText.toLowerCase())
    );

    if (filteredUsers.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center text-slate-500 text-sm py-8">
                <i class="fas fa-search text-2xl mb-2 opacity-20"></i>
                <p>No employees found</p>
            </div>
        `;
        return;
    }

    filteredUsers.forEach(user => {
        const isOnline = onlineIds.has(user.id);
        const el = document.createElement('div');
        // Match Sidebar styling
        // High contrast light theme sidebar items
        el.className = `px-4 py-3 cursor-pointer text-sm flex items-center justify-between group transition-colors duration-200 ${currentUserId === user.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-gray-50 border-l-4 border-transparent'}`;
        el.onclick = () => selectUser(user, isOnline);

        el.innerHTML = `
            <div class="flex items-center w-full">
                <div class="relative mr-3">
                    <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-700 border border-gray-200">
                        ${(user.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-300'}"></div>
                </div>
                <div class="min-w-0 flex-1">
                    <h4 class="font-bold text-gray-900 underline-offset-2 decoration-blue-500/30 group-hover:text-blue-600 transition truncate">${user.name}</h4>
                    <p class="text-xs text-gray-500 truncate font-medium">${user.email}</p>
                </div>
                <i class="fas fa-chevron-right text-xs text-slate-600 group-hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"></i>
            </div>
        `;
        listContainer.appendChild(el);
    });
}

function selectUser(user, isOnline) {
    currentUserId = user.id;

    // Stop and clear any active polling from previous user
    if (commandPollInterval) {
        clearInterval(commandPollInterval);
        commandPollInterval = null;
    }

    // Stop and clear any active live stream from previous user
    if (window.liveStreamManager) {
        window.liveStreamManager.stop();
    }

    // UI Updates
    document.getElementById('noUserSelected').classList.add('hidden');
    document.getElementById('userDashboard').classList.remove('hidden');

    // Header Name
    const headerName = document.getElementById('selectedUserNameHeader');
    if (headerName) {
        headerName.textContent = user.name;
        headerName.classList.remove('hidden');
    }

    // Detail Stats
    const statusEl = document.getElementById('detailStatus');
    if (statusEl) {
        statusEl.textContent = isOnline ? 'Online' : 'Offline';
        statusEl.className = isOnline
            ? 'text-2xl font-extrabold text-green-600 mt-0.5'
            : 'text-2xl font-extrabold text-gray-800 mt-0.5';
    }

    // Reset Live Feed
    updateLiveFeed('reset');

    // Refresh List to show active state
    loadDashboard();

    // Clear logs
    clearLogs();
    log(`Selected user: ${user.name}`);
    loadHistory(user.id);

    // Load latest screenshot automatically - this resets the view to Image
    loadLatestScreenshot(user.id, true);

    // Load screenshot count for today
    loadScreenshotCount(user.id);
}

async function loadScreenshotCount(userId) {
    if (!userId) return;
    try {
        const data = await api.getScreenshotCount(userId);
        const countEl = document.getElementById('detailScreenshots');
        if (countEl) countEl.textContent = data.count;
    } catch (err) {
        console.error("Failed to load screenshot count:", err);
    }
}

function updateLiveFeed(type, data) {
    const container = document.getElementById('liveFeedContainer');
    const placeholder = document.getElementById('feedPlaceholder');
    const image = document.getElementById('feedImage');
    const list = document.getElementById('feedList');
    const loading = document.getElementById('feedLoading');
    const titleEl = document.getElementById('liveFeedTitle');
    const expandBtn = document.getElementById('expandScreenshotBtn');

    if (!container || !placeholder || !image || !list || !loading) {
        console.error("Critical elements missing for Live Feed updates");
        return;
    }

    // GUARD: If currently in LIVE mode, do not allow other updates to overwrite it
    if (window.currentLiveFeedMode === 'live' && type !== 'live' && type !== 'reset') {
        console.log("Blocking UI update: Live stream is active");
        return;
    }

    // Reset visibility (Hide all)
    placeholder.style.display = 'none';
    image.style.display = 'none';
    list.style.display = 'none';
    loading.style.display = 'none';
    list.classList.add('hidden'); // Ensure Tailwind class is also handled if used elsewhere
    loading.classList.add('hidden');
    if (expandBtn) expandBtn.classList.add('hidden'); // Hide expand button by default

    // Update current mode
    currentLiveFeedMode = type;

    if (type === 'reset') {
        placeholder.style.display = 'block';
        if (titleEl) titleEl.textContent = 'Live Feed';
        return;
    }

    if (type === 'loading') {
        loading.style.display = 'flex';
        loading.classList.remove('hidden');
        // Keep placeholder visible behind loading if empty
        if (!image.src || image.src.endsWith('#') || image.style.display === 'none') {
            placeholder.style.display = 'block';
        }
        return;
    }

    if (type === 'image') {
        // Set source
        image.src = data;

        // Error handling for image load
        image.onerror = function () {
            log('Error loading image. Check console.', 'error');
            console.error("Image failed to load:", data);
            placeholder.style.display = 'block'; // Fallback
            image.style.display = 'none';
            if (expandBtn) expandBtn.classList.add('hidden');
        };

        image.onload = function () {
            // Only show when loaded
            image.style.display = 'block';
            // Show expand button when image is displayed
            if (expandBtn) expandBtn.classList.remove('hidden');
        };

        // Force display block immediately too, onload handles final render
        image.style.display = 'block';

        if (titleEl) titleEl.textContent = 'Remote Screen Capture';

    } else if (type === 'apps') {
        // Redesigned structured list with Application and Duration columns
        const header = `
            <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <div class="flex-1">Application</div>
                <div class="w-24 text-right">Duration</div>
            </div>
        `;

        const rows = data.map(app => {
            const name = app.name || 'Unknown';
            const icon = app.icon || 'https://placehold.co/32x32?text=?';
            const duration = app.duration || '00:00:00';

            return `
                <div class="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors border-b border-gray-900 last:border-0 group">
                    <div class="flex items-center flex-1 min-w-0">
                        <img src="${icon}" class="w-8 h-8 rounded p-0.5 bg-gray-800/50 mr-3 object-contain transition-transform group-hover:scale-110" 
                             onerror="this.src='https://placehold.co/32x32?text=?'">
                        <div class="truncate">
                            <div class="text-sm font-medium text-gray-200">${name}</div>
                            ${app.title ? `<div class="text-[10px] text-gray-500 truncate mt-0.5">${app.title}</div>` : ''}
                        </div>
                    </div>
                    <div class="w-24 text-right font-mono text-xs text-gray-400 group-hover:text-blue-400 transition-colors">
                        ${duration}
                    </div>
                </div>
            `;
        }).join('');

        list.innerHTML = `<div class="bg-black/40 rounded-lg overflow-hidden border border-gray-800">${header}${rows}</div>`;
        list.style.display = 'block';
        list.classList.remove('hidden');
        if (titleEl) titleEl.textContent = 'Active Applications';

    } else if (type === 'browser') {
        console.log("DEBUG: Received Browser Data:", data);

        let details = data.details;
        if (typeof details === 'string') {
            try { details = JSON.parse(details); } catch (e) { console.error("Parse error:", e); }
        }

        // Store for interactive navigation
        currentBrowserData = details;

        if (!details || !details.sessions || Object.keys(details.sessions).length === 0) {
            list.innerHTML = `<div class="text-gray-500 italic p-10 text-center">
                <i class="fas fa-search-minus text-3xl mb-3 opacity-20"></i>
                <p>No active browser tabs detected on the client.</p>
                <p class="text-[10px] mt-2 uppercase tracking-widest text-gray-700">Method used: ${details?.meta?.method || 'Unknown'}</p>
            </div>`;
        } else {
            renderBrowserList();
        }

        list.style.display = 'block';
        list.classList.remove('hidden');
        if (titleEl) titleEl.textContent = 'Browser Activity Monitoring';
    }
}

/**
 * Interactive Drill-down: List of Browsers
 */
function renderBrowserList() {
    if (!currentBrowserData) return;
    const list = document.getElementById('feedList');
    const sessions = currentBrowserData.sessions || {};
    const icons = currentBrowserData.icon_meta || {};

    let html = `
        <div class="mb-4 px-2 flex items-center justify-between">
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Active Browsers</div>
            <div class="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 border border-slate-700">
                ${Object.keys(sessions).length} detected
            </div>
        </div>
        <div class="grid grid-cols-1 gap-2.5">
    `;

    const browserNames = Object.keys(sessions).filter(k => k !== 'icon_meta').sort();
    if (browserNames.length === 0) {
        html += `
            <div class="flex flex-col items-center justify-center p-12 text-slate-600 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800">
                <i class="fas fa-browser text-4xl mb-3 opacity-20"></i>
                <p class="text-sm">No active browsers detected</p>
            </div>`;
    } else {
        browserNames.forEach(name => {
            const count = sessions[name].length;
            const icon = icons[name];

            const iconHtml = icon
                ? `<div class="relative">
                     <img src="${icon}" class="w-11 h-11 object-contain rounded-xl p-1.5 bg-slate-800 border border-slate-700 group-hover:border-blue-500/50 transition-colors shadow-lg">
                   </div>`
                : `<div class="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-700 group-hover:border-blue-500/50 transition-colors">
                     <i class="fab fa-${name.toLowerCase().includes('chrome') ? 'chrome' : (name.toLowerCase().includes('edge') ? 'edge' : 'globe')} text-slate-400 text-xl"></i>
                   </div>`;

            html += `
                <div onclick="renderTabList('${name}')" 
                     class="flex items-center justify-between p-4 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-800/80 hover:border-blue-500/40 hover:bg-blue-500/5 cursor-pointer transition-all duration-300 group shadow-sm">
                    <div class="flex items-center space-x-4">
                        ${iconHtml}
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-slate-100 group-hover:text-blue-400 transition-colors tracking-tight">${name}</div>
                            <div class="flex items-center mt-0.5 space-x-2">
                                <span class="text-[10px] text-slate-500 font-medium uppercase tracking-wider">${count} Open Tabs</span>
                                <span class="w-1 h-1 rounded-full bg-slate-700"></span>
                                <span class="text-[10px] text-blue-500/80 font-semibold uppercase">Active Session</span>
                            </div>
                        </div>
                    </div>
                    <div class="w-8 h-8 rounded-full flex items-center justify-center bg-slate-800/50 group-hover:bg-blue-500/20 group-hover:text-blue-400 text-slate-600 transition-all">
                        <i class="fas fa-chevron-right text-[10px]"></i>
                    </div>
                </div>
            `;
        });
    }

    html += `</div>`;
    list.innerHTML = html;
}

function renderTabList(browserName) {
    if (!currentBrowserData || !currentBrowserData.sessions[browserName]) return;
    const list = document.getElementById('feedList');
    const tabs = currentBrowserData.sessions[browserName];

    let html = `
        <div class="flex items-center mb-5 pb-3 border-b border-slate-800/50">
            <button onclick="renderBrowserList()" class="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center mr-4 hover:bg-slate-700 hover:text-white transition-all text-slate-400 shadow-sm border border-slate-700">
                <i class="fas fa-arrow-left text-[10px]"></i>
            </button>
            <div class="min-w-0 flex-1">
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Browsing History</div>
                <div class="text-sm font-bold text-slate-100 truncate">${browserName}</div>
            </div>
            <div class="ml-4 px-2.5 py-1 bg-blue-500/10 rounded-lg text-[10px] font-bold text-blue-400 border border-blue-500/20">
                ${tabs.length} Tabs
            </div>
        </div>
        <div class="space-y-2.5">
    `;

    tabs.forEach(tab => {
        const urlStr = tab.url ? `<div class="text-[10px] text-blue-400/70 truncate mt-1 italic tracking-tight">${tab.url}</div>` : '';

        // Use tab icon (favicon) with fallback
        const tabIconHtml = tab.icon
            ? `<div class="relative shrink-0">
                 <img src="${tab.icon}" class="w-9 h-9 object-contain rounded-lg bg-white/5 p-1 border border-slate-700/50 group-hover:border-blue-500/30 transition-colors shadow-sm"
                      onerror="this.src='https://www.google.com/s2/favicons?sz=64&domain=google.com'">
               </div>`
            : `<div class="w-9 h-9 rounded-lg bg-slate-800/80 flex items-center justify-center shrink-0 border border-slate-700/50 group-hover:border-blue-500/30 transition-colors">
                 <i class="fas fa-globe text-[11px] text-slate-500 group-hover:text-blue-400"></i>
               </div>`;

        html += `
            <div class="p-3.5 bg-slate-900/50 backdrop-blur-sm rounded-xl border border-slate-800/50 hover:border-slate-700 hover:bg-slate-800/40 transition-all duration-200 group relative">
                <div class="flex items-center">
                    ${tabIconHtml}
                    <div class="min-w-0 flex-1 ml-4">
                        <div class="text-xs text-slate-200 font-semibold leading-tight group-hover:text-white transition-colors truncate">${tab.title}</div>
                        ${urlStr}
                    </div>
                    ${tab.is_active ? `
                        <div class="ml-2 w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                    ` : ''}
                </div>
                <!-- Tooltip for full URL on hover -->
                ${tab.url ? `<div class="absolute inset-0 z-10 opacity-0 bg-transparent" title="${tab.url}"></div>` : ''}
            </div>
        `;
    });

    html += `</div>`;
    list.innerHTML = html;
}


async function triggerCommand(commandType) {
    if (!currentUserId) return;

    // Update Title for Immediate Feedback
    const titleEl = document.getElementById('liveFeedTitle');
    if (titleEl) {
        if (commandType === 'TAKE_SCREENSHOT') titleEl.textContent = 'Requesting Screenshot...';
        if (commandType === 'GET_RUNNING_APPS') titleEl.textContent = 'Fetching Running Apps...';
        if (commandType === 'GET_BROWSER_STATUS') titleEl.textContent = 'Checking Browser Activity...';
    }

    updateLiveFeed('loading');
    log(`Sending command: ${commandType}...`);

    try {
        const res = await api.sendCommand(currentUserId, commandType);
        log(`Command SENT. ID: ${res.command_id}`, 'success');
        pollForCommandResult(res.command_id, commandType, currentUserId);

    } catch (err) {
        log(`Failed to send command: ${err.message}`, 'error');
        updateLiveFeed('reset');
    }
}

async function pollForCommandResult(commandId, type, userId) {
    let attempts = 0;
    const maxAttempts = 15; // 30 seconds

    if (commandPollInterval) clearInterval(commandPollInterval);

    commandPollInterval = setInterval(async () => {
        attempts++;
        const titleEl = document.getElementById('liveFeedTitle');
        if (attempts > maxAttempts) {
            clearInterval(commandPollInterval);
            log(`Timeout waiting for ${type} result.`, 'warning');
            updateLiveFeed('reset');
            // Update title to show timeout
            if (titleEl) titleEl.textContent = `${type} Request Timed Out`;
            return;
        }

        try {
            if (attempts % 3 === 0) log(`Polling... (${attempts}/${maxAttempts})`); // Debug log

            if (type === 'TAKE_SCREENSHOT') {
                const res = await api.getScreenshot(commandId);
                if (res.url) {
                    clearInterval(commandPollInterval);
                    log(`Screenshot received!`, 'success');

                    // Display in Live Feed Container
                    // Prefer Base64 (image_data) if available to avoid CORS/Mixed Content issues
                    let imageUrl;
                    if (res.image_data) {
                        imageUrl = res.image_data;
                    } else {
                        // Fallback to URL with timestamp
                        imageUrl = `${res.url}?t=${new Date().getTime()}`;
                    }

                    updateLiveFeed('image', imageUrl);

                    // Refresh screenshot count for today
                    loadScreenshotCount(userId);
                }
            } else if (type === 'GET_RUNNING_APPS') {
                const history = await api.getCommandHistory(userId);
                const cmd = history.find(c => c.id === commandId);
                if (cmd && cmd.status === 'EXECUTED') {
                    clearInterval(commandPollInterval);
                    const appsData = await api.getApps(userId);
                    log(`Apps received: ${appsData.apps.length} running.`, 'success');
                    updateLiveFeed('apps', appsData.apps);

                    // Update stats card with the actual active application (foreground)
                    const appEl = document.getElementById('detailApp');
                    if (appEl && appsData.apps.length > 0) {
                        // Find the one marked as is_active, or fallback to first
                        const activeApp = appsData.apps.find(a => a.is_active) || appsData.apps[0];
                        appEl.textContent = activeApp.name || activeApp;
                        appEl.title = activeApp.name || activeApp;
                    }
                } else if (cmd && cmd.status === 'FAILED') {
                    clearInterval(commandPollInterval);
                    log('Command FAILED on client.', 'error');
                    updateLiveFeed('reset');
                }
            } else if (type === 'GET_BROWSER_STATUS') {
                const history = await api.getCommandHistory(userId);
                const cmd = history.find(c => c.id === commandId);
                if (cmd && cmd.status === 'EXECUTED') {
                    clearInterval(commandPollInterval);
                    const browserData = await api.getBrowser(userId);
                    log(`Browser: ${browserData.browser}`, 'success');
                    updateLiveFeed('browser', browserData);
                }
            }
        } catch (e) {
            // Ignore errors while polling, but log fatal ones
            if (attempts % 5 === 0) log(`Polling error: ${e.message}`, 'warning');
            console.log("Polling error:", e);
        }

    }, 2000);
}

// ------ Modals & Helpers ------

function showNotifyModal() {
    if (!currentUserId) return;
    document.getElementById('notifyModal').classList.remove('hidden');
}

// ------ Admin Notification Toast Functions ------
function showAdminToast(userName, message) {
    const toast = document.getElementById('adminNotificationToast');
    const userEl = document.getElementById('adminToastUser');
    const msgEl = document.getElementById('adminToastMsg');

    if (!toast || !userEl || !msgEl) return;

    userEl.textContent = userName;
    msgEl.textContent = message;

    // Show toast
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    // Auto hide after 8 seconds
    if (window.adminToastTimeout) clearTimeout(window.adminToastTimeout);
    window.adminToastTimeout = setTimeout(() => hideAdminToast(), 8000);

    // Also log it
    log(`${userName}: ${message}`, 'success');
}

function hideAdminToast() {
    const toast = document.getElementById('adminNotificationToast');
    if (toast) {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }
}

function closeNotifyModal() { // Renamed to match HTML call? Wait, HTML calls document.getElementById... hidden.
    // HTML uses: onclick="document.getElementById('notifyModal').classList.add('hidden')"
    // But let's keep this clean
    document.getElementById('notifyModal').classList.add('hidden');
}

async function sendNotification() {
    const title = document.getElementById('notifyTitle').value;
    const msg = document.getElementById('notifyMessage').value;

    if (!title || !msg) return;

    try {
        await api.sendNotification(currentUserId, title, msg);
        log(`Notification sent: "${title}"`, 'success');
        document.getElementById('notifyModal').classList.add('hidden');
    } catch (err) {
        log(`Failed to send notification: ${err.message}`, 'error');
    }
}

// Modal closing logic is partly in HTML onclicks, keeping consistent
function closeModal() {
    document.getElementById('screenshotModal').classList.add('hidden');
}

// Logs
function log(msg, type = 'info') {
    const logContainer = document.getElementById('commandLogTable'); // This is a table body in restored HTML?
    // Wait, HTML has <tbody id="commandLogTable">
    // Previous app.js was targeting outputLog div.
    // Restored HTML (Line 231): <tbody id="commandLogTable" class="divide-y divide-gray-50"></tbody>

    if (!logContainer) return;

    const row = document.createElement('tr');
    const time = new Date().toLocaleTimeString();

    let statusColor = 'text-gray-500';
    if (type === 'success') statusColor = 'text-green-500 font-bold';
    if (type === 'error') statusColor = 'text-red-500 font-bold';
    if (type === 'warning') statusColor = 'text-yellow-500';

    row.innerHTML = `
        <td class="p-2 text-gray-700 font-medium">${msg}</td>
        <td class="p-2 ${statusColor} text-xs uppercase">${type}</td>
        <td class="p-2 text-right text-gray-400 text-xs">${time}</td>
    `;

    logContainer.prepend(row);
}

function clearLogs() {
    const logContainer = document.getElementById('commandLogTable');
    if (logContainer) logContainer.innerHTML = '';
}

async function loadHistory(userId) {
    // Optional: Load persistent history from API
}

function toggleNavDrawer() {
    const drawer = document.getElementById('navDrawer');
    const overlay = document.getElementById('navOverlay');

    if (drawer.classList.contains('translate-x-full')) {
        drawer.classList.remove('translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        drawer.classList.add('translate-x-full');
        overlay.classList.add('hidden');
    }
}

// ------ Latest Screenshot Functions ------

async function loadLatestScreenshot(userId, forceRefresh = false) {
    if (!userId) return;

    // Guard: Don't override if user is looking at Apps or Browser, unless forced (e.g. user selection)
    if (!forceRefresh && currentLiveFeedMode !== 'image' && currentLiveFeedMode !== 'reset' && currentLiveFeedMode !== 'loading') {
        return;
    }

    try {
        const data = await api.getLatestScreenshot(userId);

        // Prefer base64 image_data if available
        let imageUrl;
        if (data.image_data) {
            imageUrl = data.image_data;
        } else {
            // Fallback to URL with cache-busting timestamp
            imageUrl = `${data.url}?t=${new Date().getTime()}`;
        }

        // Update live feed with the screenshot
        updateLiveFeed('image', imageUrl);

        log('Latest screenshot loaded', 'success');

    } catch (err) {
        // No screenshot available - this is normal for new users
        console.log('No screenshot available:', err.message);
        // Keep the placeholder visible
        updateLiveFeed('reset');
    }
}

// Expand screenshot to fullscreen
function expandScreenshot() {
    const feedImage = document.getElementById('feedImage');
    const modal = document.getElementById('screenshotModal');
    const previewImage = document.getElementById('screenshotPreview');
    const downloadLink = document.getElementById('downloadLink');

    if (!feedImage || !feedImage.src || feedImage.style.display === 'none') {
        console.log('No screenshot to expand');
        return;
    }

    // Set the modal image to the current feed image
    if (previewImage) previewImage.src = feedImage.src;
    if (downloadLink) downloadLink.href = feedImage.src;

    // Show modal
    if (modal) {
        modal.classList.remove('hidden');
        log('Screenshot expanded to fullscreen', 'info');
    }
}

async function checkServerConnection() {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    const dot = statusEl.querySelector('div');
    const text = statusEl.querySelector('span');

    try {
        const isConnected = await api.checkConnection();

        if (isConnected) {
            dot.className = 'h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
            text.textContent = 'Connected';
            text.className = 'text-[10px] font-bold text-green-600 uppercase tracking-wider';
            statusEl.className = 'flex items-center space-x-2 px-3 py-1 bg-green-50 rounded-full border border-green-200';
        } else {
            dot.className = 'h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
            text.textContent = 'Disconnected';
            text.className = 'text-[10px] font-bold text-red-600 uppercase tracking-wider';
            statusEl.className = 'flex items-center space-x-2 px-3 py-1 bg-red-50 rounded-full border border-red-200';

            // Log explicitly to help user identify mismatch
            console.error(`DASHBOARD DISCONNECTED: Failed to reach API at ${api.baseUrl}. Ensure your server is running and the URL is correct.`);
        }
    } catch (e) {
        console.error("Connection check failed:", e);
    }
}

async function runApiDiagnostics() {
    alert("Starting API Diagnostics... Check console and logs.");
    log("--- STARTING API DIAGNOSTICS ---");

    const endpoints = [
        { name: "Public Ping", path: "/", method: "GET" },
        { name: "Live Stream Test (GET)", path: "/admin/live/test", method: "GET" },
        { name: "Live Stream Trigger (POST)", path: "/admin/live/start", method: "POST", body: { user_id: "test-diag", command: "START_LIVE_STREAM" } }
    ];

    for (const ep of endpoints) {
        log(`Testing ${ep.name} [${ep.method} ${ep.path}]...`);
        try {
            const url = `${api.baseUrl}${ep.path}`;
            const options = {
                method: ep.method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                }
            };
            if (ep.body) options.body = JSON.stringify(ep.body);

            const start = performance.now();
            const response = await fetch(url, options);
            const duration = (performance.now() - start).toFixed(0);

            if (response.ok) {
                log(`[${response.status}] ${ep.name} SUCCESS (${duration}ms)`, "success");
            } else {
                log(`[${response.status}] ${ep.name} FAILED: ${response.statusText}`, "error");
                if (response.status === 404) {
                    log(`ADVICE: 404 means the route is missing on the server at ${api.baseUrl}.`, "warning");
                }
            }
        } catch (err) {
            log(`[ERROR] ${ep.name} CRITICAL: ${err.message}`, "error");
        }
    }
    log("--- DIAGNOSTICS COMPLETE ---");
    alert("Diagnostics complete. View the Action Output list for results.");
}

