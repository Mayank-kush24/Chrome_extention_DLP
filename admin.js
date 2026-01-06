/**
 * Admin Console Script
 * Handles password authentication, request approval/denial, audit log display, and session management
 */

(function() {
  'use strict';

  const ADMIN_PASSWORD_KEY = 'adminPassword';
  const ADMIN_SESSION_KEY = 'isAdminSession';
  const STORAGE_KEYS = {
    PENDING_REQUESTS: 'pendingRequests',
    APPROVED_SESSIONS: 'approvedSessions',
    AUDIT_LOGS: 'auditLogs',
    TRACKED_DEVICES: 'trackedDevices'
  };

  const DEFAULT_PASSWORD = 'admin123'; // Default password - should be changed in production

  const loginContainer = document.getElementById('loginContainer');
  const adminContainer = document.getElementById('adminContainer');
  const adminPasswordInput = document.getElementById('adminPassword');
  const loginButton = document.getElementById('loginButton');
  const loginError = document.getElementById('loginError');
  const logoutButton = document.getElementById('logoutButton');
  const exportLogsButton = document.getElementById('exportLogsButton');

  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // Pagination settings
  const ITEMS_PER_PAGE = 50;
  let currentPage = {
    requests: 1,
    logs: 1,
    sessions: 1,
    devices: 1
  };
  let filteredData = {
    requests: [],
    logs: [],
    sessions: [],
    devices: []
  };

  /**
   * Simple password hashing (for extension context)
   */
  function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  /**
   * Checks if user is authenticated
   */
  function checkAuth() {
    chrome.storage.local.get([ADMIN_SESSION_KEY], function(result) {
      if (result[ADMIN_SESSION_KEY]) {
        showAdminConsole();
      } else {
        showLogin();
      }
    });
  }

  /**
   * Initializes admin password if not set
   */
  function initAdminPassword() {
    chrome.storage.local.get([ADMIN_PASSWORD_KEY], function(result) {
      if (!result[ADMIN_PASSWORD_KEY]) {
        chrome.storage.local.set({ [ADMIN_PASSWORD_KEY]: hashPassword(DEFAULT_PASSWORD) });
      }
    });
  }

  /**
   * Handles login
   */
  function handleLogin() {
    const password = adminPasswordInput.value;
    if (!password) {
      showError('Please enter a password');
      return;
    }

    chrome.storage.local.get([ADMIN_PASSWORD_KEY], function(result) {
      const storedHash = result[ADMIN_PASSWORD_KEY] || hashPassword(DEFAULT_PASSWORD);
      const inputHash = hashPassword(password);

      if (inputHash === storedHash) {
        chrome.storage.local.set({ [ADMIN_SESSION_KEY]: true }, function() {
          showAdminConsole();
        });
      } else {
        showError('Invalid password');
      }
    });
  }

  /**
   * Handles logout
   */
  function handleLogout() {
    chrome.storage.local.set({ [ADMIN_SESSION_KEY]: false }, function() {
      showLogin();
    });
  }

  /**
   * Shows login form
   */
  function showLogin() {
    loginContainer.style.display = 'block';
    adminContainer.style.display = 'none';
    adminPasswordInput.value = '';
    loginError.style.display = 'none';
  }

  /**
   * Shows admin console
   */
  function showAdminConsole() {
    loginContainer.style.display = 'none';
    adminContainer.style.display = 'block';
    loadRequests();
    loadLogs();
    loadSessions();
    switchTab('requests');
  }

  /**
   * Shows error message
   */
  function showError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
  }

  /**
   * Handles tab switching
   */
  function switchTab(tabName) {
    tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    tabContents.forEach(content => {
      if (content.id === tabName + 'Tab') {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    if (tabName === 'requests') {
      loadRequests();
    } else if (tabName === 'logs') {
      loadLogs();
    } else if (tabName === 'sessions') {
      loadSessions();
    } else if (tabName === 'devices') {
      loadDevices();
    }
  }

  /**
   * Loads and displays requests
   */
  function loadRequests() {
    chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS], function(result) {
      const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
      const tbody = document.getElementById('requestsTableBody');
      
      // Update stats
      const pendingCount = requests.filter(r => r.status === 'pending').length;
      document.getElementById('pendingCount').textContent = pendingCount;
      document.getElementById('totalRequests').textContent = requests.length;

      if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No requests found</td></tr>';
        return;
      }

      // Sort by timestamp (newest first)
      requests.sort((a, b) => b.timestamp - a.timestamp);
      
      // Store filtered data for pagination
      filteredData.requests = requests;
      
      // Render with pagination
      renderRequestsPage();
    });
  }
  
  /**
   * Renders requests with pagination
   */
  function renderRequestsPage() {
    const tbody = document.getElementById('requestsTableBody');
    const requests = filteredData.requests;
    const totalPages = Math.ceil(requests.length / ITEMS_PER_PAGE);
    const page = currentPage.requests;
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageRequests = requests.slice(start, end);

      if (requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No requests found</td></tr>';
        updatePagination('requests', 0, 0);
        return;
      }

      tbody.innerHTML = pageRequests.map(request => {
        const date = new Date(request.timestamp);
        const statusClass = `status-${request.status}`;
        const statusBadge = `<span class="status-badge ${statusClass}">${request.status}</span>`;
        
        let actions = '';
        if (request.status === 'pending') {
          actions = `
            <div class="action-buttons">
              <button class="btn btn-approve btn-small" data-action="approve" data-request-id="${request.id}">Approve</button>
              <button class="btn btn-deny btn-small" data-action="deny" data-request-id="${request.id}">Deny</button>
            </div>
          `;
        } else {
          actions = `<span style="color: #5f6368; font-size: 12px;">${request.approvedBy || 'N/A'}</span>`;
        }

        return `
          <tr>
            <td>${request.userId}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${request.url}</td>
            <td>${request.duration} min (${request.durationType})</td>
            <td>${date.toLocaleString()}</td>
            <td>${statusBadge}</td>
            <td>${actions}</td>
          </tr>
        `;
      }).join('');
      
      // Attach event listeners to buttons using event delegation
      attachRequestButtonListeners();
      
      // Update pagination
      updatePagination('requests', requests.length, totalPages);
  }
  
  /**
   * Updates pagination controls
   */
  function updatePagination(type, totalItems, totalPages) {
    const page = currentPage[type];
    let paginationDiv = document.getElementById(`${type}Pagination`);
    
    if (!paginationDiv) {
      paginationDiv = document.createElement('div');
      paginationDiv.id = `${type}Pagination`;
      paginationDiv.className = 'pagination';
      paginationDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding: 12px;';
      
      const tableContainer = document.getElementById(`${type}Tab`).querySelector('.table-container');
      if (tableContainer) {
        tableContainer.parentNode.insertBefore(paginationDiv, tableContainer.nextSibling);
      }
    }
    
    if (totalPages <= 1) {
      paginationDiv.style.display = 'none';
      return;
    }
    
    paginationDiv.style.display = 'flex';
    paginationDiv.innerHTML = `
      <div style="color: #5f6368; font-size: 13px;">
        Showing ${((page - 1) * ITEMS_PER_PAGE) + 1}-${Math.min(page * ITEMS_PER_PAGE, totalItems)} of ${totalItems}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary" ${page === 1 ? 'disabled' : ''} data-pagination-action="prev" data-pagination-type="${type}" style="padding: 6px 12px; font-size: 12px;">Previous</button>
        <span style="padding: 6px 12px; font-size: 12px; color: #202124;">Page ${page} of ${totalPages}</span>
        <button class="btn btn-secondary" ${page === totalPages ? 'disabled' : ''} data-pagination-action="next" data-pagination-type="${type}" style="padding: 6px 12px; font-size: 12px;">Next</button>
      </div>
    `;
    
    // Attach event listeners to pagination buttons
    const prevBtn = paginationDiv.querySelector('[data-pagination-action="prev"]');
    const nextBtn = paginationDiv.querySelector('[data-pagination-action="next"]');
    
    if (prevBtn && !prevBtn.disabled) {
      prevBtn.addEventListener('click', function() {
        goToPage(type, page - 1);
      });
    }
    
    if (nextBtn && !nextBtn.disabled) {
      nextBtn.addEventListener('click', function() {
        goToPage(type, page + 1);
      });
    }
  }
  
  /**
   * Navigates to a specific page
   */
  function goToPage(type, page) {
    currentPage[type] = page;
    if (type === 'requests') {
      renderRequestsPage();
    } else if (type === 'logs') {
      renderLogsPage();
    } else if (type === 'sessions') {
      renderSessionsPage();
    } else if (type === 'devices') {
      renderDevicesPage();
    }
  }
  
  /**
   * Attaches event listeners to approve/deny buttons using event delegation
   */
  function attachRequestButtonListeners() {
    const tbody = document.getElementById('requestsTableBody');
    if (!tbody) return;
    
    // Remove existing listeners to avoid duplicates
    const newTbody = tbody.cloneNode(true);
    tbody.parentNode.replaceChild(newTbody, tbody);
    
    // Use event delegation on the table body
    newTbody.addEventListener('click', function(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      
      const action = button.dataset.action;
      const requestId = button.dataset.requestId;
      
      if (!requestId) return;
      
      if (action === 'approve') {
        approveRequest(requestId);
      } else if (action === 'deny') {
        denyRequest(requestId);
      }
    });
  }

  /**
   * Approves a request
   */
  function approveRequest(requestId) {
    chrome.runtime.sendMessage({
      action: 'approveRequest',
      requestId: requestId,
      adminId: 'admin'
    }, function(response) {
      if (response && response.success) {
        loadRequests();
        loadSessions();
      } else {
        alert('Failed to approve request: ' + (response && response.error ? response.error : 'Unknown error'));
      }
    });
  }

  /**
   * Denies a request
   */
  function denyRequest(requestId) {
    chrome.runtime.sendMessage({
      action: 'denyRequest',
      requestId: requestId,
      adminId: 'admin'
    }, function(response) {
      if (response && response.success) {
        loadRequests();
      } else {
        alert('Failed to deny request: ' + (response && response.error ? response.error : 'Unknown error'));
      }
    });
  }

  /**
   * Loads and displays audit logs
   */
  function loadLogs() {
    chrome.storage.local.get([STORAGE_KEYS.AUDIT_LOGS], function(result) {
      const logs = result[STORAGE_KEYS.AUDIT_LOGS] || [];
      const tbody = document.getElementById('logsTableBody');

      // Apply filters
      const typeFilter = document.getElementById('logTypeFilter').value;
      const fromDate = document.getElementById('logFromDate').value;
      const toDate = document.getElementById('logToDate').value;
      const userIdFilter = document.getElementById('logUserIdFilter').value.toLowerCase();

      let filteredLogs = logs;

      if (typeFilter) {
        filteredLogs = filteredLogs.filter(log => log.type === typeFilter);
      }

      if (fromDate) {
        const fromTimestamp = new Date(fromDate).getTime();
        filteredLogs = filteredLogs.filter(log => log.timestamp >= fromTimestamp);
      }

      if (toDate) {
        const toTimestamp = new Date(toDate).getTime() + 86400000; // Add 24 hours
        filteredLogs = filteredLogs.filter(log => log.timestamp <= toTimestamp);
      }

      if (userIdFilter) {
        filteredLogs = filteredLogs.filter(log => 
          log.userId && log.userId.toLowerCase().includes(userIdFilter)
        );
      }

      // Sort by timestamp (newest first)
      filteredLogs.sort((a, b) => b.timestamp - a.timestamp);
      
      // Store filtered data for pagination
      filteredData.logs = filteredLogs;
      
      // Render with pagination
      renderLogsPage();
    });
  }
  
  /**
   * Renders logs with pagination
   */
  function renderLogsPage() {
    const tbody = document.getElementById('logsTableBody');
    const logs = filteredData.logs;
    const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE);
    const page = currentPage.logs;
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageLogs = logs.slice(start, end);

      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No logs found</td></tr>';
        updatePagination('logs', 0, 0);
        return;
      }

      tbody.innerHTML = pageLogs.map(log => {
        const date = new Date(log.timestamp);
        return `
          <tr>
            <td>${date.toLocaleString()}</td>
            <td><span class="status-badge status-${log.type}">${log.type}</span></td>
            <td>${log.action || 'N/A'}</td>
            <td>${log.userId || 'N/A'}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${log.url || 'N/A'}</td>
            <td>${log.details || 'N/A'}</td>
          </tr>
        `;
      }).join('');
      
      // Update pagination
      updatePagination('logs', logs.length, totalPages);
  }

  /**
   * Loads and displays active sessions
   */
  function loadSessions() {
    chrome.storage.local.get([STORAGE_KEYS.APPROVED_SESSIONS], function(result) {
      const sessions = result[STORAGE_KEYS.APPROVED_SESSIONS] || [];
      const tbody = document.getElementById('sessionsTableBody');
      const now = Date.now();

      // Filter active sessions
      const activeSessions = sessions.filter(s => s.expiresAt > now);
      
      // Store filtered data for pagination
      filteredData.sessions = activeSessions;
      
      // Render with pagination
      renderSessionsPage();
    });
  }
  
  /**
   * Renders sessions with pagination
   */
  function renderSessionsPage() {
    const tbody = document.getElementById('sessionsTableBody');
    const sessions = filteredData.sessions;
    const totalPages = Math.ceil(sessions.length / ITEMS_PER_PAGE);
    const page = currentPage.sessions;
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageSessions = sessions.slice(start, end);
    const now = Date.now();

      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No active sessions</td></tr>';
        updatePagination('sessions', 0, 0);
        return;
      }

      tbody.innerHTML = pageSessions.map(session => {
        const expiresDate = new Date(session.expiresAt);
        const timeRemaining = Math.floor((session.expiresAt - now) / 1000 / 60);
        const timeRemainingText = timeRemaining > 0 ? `${timeRemaining} min` : 'Expired';

        return `
          <tr>
            <td>${session.userId}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${session.url}</td>
            <td>${session.requestId}</td>
            <td>${expiresDate.toLocaleString()}</td>
            <td>${timeRemainingText}</td>
          </tr>
        `;
      }).join('');
      
      // Update pagination
      updatePagination('sessions', sessions.length, totalPages);
  }

  /**
   * Loads and displays devices
   */
  function loadDevices() {
    chrome.runtime.sendMessage({ action: 'getDevices' }, function(response) {
      if (!response || !response.success) {
        const tbody = document.getElementById('devicesTableBody');
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Error loading devices</td></tr>';
        return;
      }
      
      const devices = response.devices || [];
      const tbody = document.getElementById('devicesTableBody');
      
      // Update stats
      const activeCount = devices.filter(d => d.status === 'active').length;
      const removedCount = devices.filter(d => d.status === 'removed').length;
      document.getElementById('activeDevicesCount').textContent = activeCount;
      document.getElementById('removedDevicesCount').textContent = removedCount;
      document.getElementById('totalDevicesCount').textContent = devices.length;
      
      // Apply filters
      const statusFilter = document.getElementById('deviceStatusFilter').value;
      const userIdFilter = document.getElementById('deviceUserIdFilter').value.toLowerCase();
      
      let filteredDevices = devices;
      
      if (statusFilter) {
        filteredDevices = filteredDevices.filter(d => d.status === statusFilter);
      }
      
      if (userIdFilter) {
        filteredDevices = filteredDevices.filter(d => 
          d.userId && d.userId.toLowerCase().includes(userIdFilter)
        );
      }
      
      // Sort by last seen (newest first)
      filteredDevices.sort((a, b) => b.lastSeen - a.lastSeen);
      
      // Store filtered data for pagination
      filteredData.devices = filteredDevices;
      
      // Render with pagination
      renderDevicesPage();
    });
  }
  
  /**
   * Renders devices with pagination
   */
  function renderDevicesPage() {
    const tbody = document.getElementById('devicesTableBody');
    const devices = filteredData.devices;
    const totalPages = Math.ceil(devices.length / ITEMS_PER_PAGE);
    const page = currentPage.devices;
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageDevices = devices.slice(start, end);
    
    if (devices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No devices found</td></tr>';
      updatePagination('devices', 0, 0);
      return;
    }
    
    tbody.innerHTML = pageDevices.map(device => {
      const firstSeenDate = new Date(device.firstSeen);
      const lastSeenDate = new Date(device.lastSeen);
      const statusClass = `status-${device.status}`;
      const statusBadge = `<span class="status-badge ${statusClass}">${device.status}</span>`;
      
      return `
        <tr>
          <td>${device.userId || 'N/A'}</td>
          <td>${device.email || 'Not available'}</td>
          <td>${device.browser || 'Unknown'}</td>
          <td>${device.os || 'Unknown'}</td>
          <td>${device.ip || 'Unknown'}</td>
          <td>${firstSeenDate.toLocaleString()}</td>
          <td>${lastSeenDate.toLocaleString()}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
    
    // Update pagination
    updatePagination('devices', devices.length, totalPages);
  }

  /**
   * Exports logs to JSON
   */
  function exportLogs() {
    chrome.storage.local.get([STORAGE_KEYS.AUDIT_LOGS], function(result) {
      const logs = result[STORAGE_KEYS.AUDIT_LOGS] || [];
      const dataStr = JSON.stringify(logs, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  // Event listeners
  loginButton.addEventListener('click', handleLogin);
  adminPasswordInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      handleLogin();
    }
  });
  logoutButton.addEventListener('click', handleLogout);
  exportLogsButton.addEventListener('click', exportLogs);

  tabs.forEach(tab => {
    tab.addEventListener('click', function() {
      switchTab(this.dataset.tab);
    });
  });

  // Filter listeners with debouncing
  let logFilterTimeout = null;
  function debouncedLoadLogs() {
    if (logFilterTimeout) clearTimeout(logFilterTimeout);
    logFilterTimeout = setTimeout(loadLogs, 300);
  }
  
  document.getElementById('logTypeFilter').addEventListener('change', function() {
    currentPage.logs = 1;
    loadLogs();
  });
  document.getElementById('logFromDate').addEventListener('change', function() {
    currentPage.logs = 1;
    loadLogs();
  });
  document.getElementById('logToDate').addEventListener('change', function() {
    currentPage.logs = 1;
    loadLogs();
  });
  document.getElementById('logUserIdFilter').addEventListener('input', function() {
    currentPage.logs = 1;
    debouncedLoadLogs();
  });
  
  // Device filter listeners
  let deviceFilterTimeout = null;
  function debouncedLoadDevices() {
    if (deviceFilterTimeout) clearTimeout(deviceFilterTimeout);
    deviceFilterTimeout = setTimeout(loadDevices, 300);
  }
  
  document.getElementById('deviceStatusFilter').addEventListener('change', function() {
    currentPage.devices = 1;
    loadDevices();
  });
  document.getElementById('deviceUserIdFilter').addEventListener('input', function() {
    currentPage.devices = 1;
    debouncedLoadDevices();
  });

  // Initialize
  initAdminPassword();
  checkAuth();

  // Refresh data every 30 seconds (less frequent for better performance)
  setInterval(function() {
    if (adminContainer.style.display !== 'none') {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.tab === 'requests') {
        loadRequests();
      } else if (activeTab && activeTab.dataset.tab === 'sessions') {
        loadSessions();
      } else if (activeTab && activeTab.dataset.tab === 'devices') {
        loadDevices();
      }
    }
  }, 30000);

})();

