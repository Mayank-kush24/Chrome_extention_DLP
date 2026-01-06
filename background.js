/**
 * Background Service Worker
 * Manages badge updates, request storage, and session expiration
 * Optimized for large-scale usage
 */

(function() {
  'use strict';

  const STORAGE_KEYS = {
    PENDING_REQUESTS: 'pendingRequests',
    APPROVED_SESSIONS: 'approvedSessions',
    AUDIT_LOGS: 'auditLogs',
    TRACKED_DEVICES: 'trackedDevices',
    REMOVED_DEVICES_COUNT: 'removedDevicesCount'
  };

  // Cache for performance
  let badgeCountCache = 0;
  let sessionsCache = null;
  let sessionsCacheTime = 0;
  const SESSION_CACHE_TTL = 5000; // 5 seconds
  
  // Device tracking
  let currentDeviceId = null;
  const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const REMOVAL_CHECK_INTERVAL = 60 * 1000; // 1 minute
  const REMOVAL_THRESHOLD = 60 * 60 * 1000; // 1 hour

  // Batch logging queue
  let logQueue = [];
  let logFlushTimer = null;
  const LOG_BATCH_SIZE = 50;
  const LOG_FLUSH_INTERVAL = 2000; // 2 seconds

  /**
   * Updates the badge with pending request count (cached)
   */
  function updateBadge() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS, STORAGE_KEYS.REMOVED_DEVICES_COUNT], function(result) {
        const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
        const pendingCount = requests.filter(r => r.status === 'pending').length;
        const removedDevicesCount = result[STORAGE_KEYS.REMOVED_DEVICES_COUNT] || 0;
        
        // Prioritize removed devices count, then pending requests
        const badgeCount = removedDevicesCount > 0 ? removedDevicesCount : pendingCount;
        
        // Only update if count changed
        if (badgeCount !== badgeCountCache) {
          badgeCountCache = badgeCount;
          
          if (badgeCount > 0) {
            chrome.action.setBadgeText({ text: String(badgeCount) });
            chrome.action.setBadgeBackgroundColor({ color: '#ea4335' });
          } else {
            chrome.action.setBadgeText({ text: '' });
          }
        }
      });
    } catch (error) {
      console.warn('Error updating badge:', error);
    }
  }

  /**
   * Cleans up expired sessions
   */
  function cleanupExpiredSessions() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.APPROVED_SESSIONS], function(result) {
        const sessions = result[STORAGE_KEYS.APPROVED_SESSIONS] || [];
        const now = Date.now();
        const activeSessions = sessions.filter(session => session.expiresAt > now);
        
        if (activeSessions.length !== sessions.length) {
          chrome.storage.local.set({ [STORAGE_KEYS.APPROVED_SESSIONS]: activeSessions }, function() {
            // Log expired sessions
            const expired = sessions.filter(session => session.expiresAt <= now);
            expired.forEach(session => {
              logAuditEvent({
                type: 'session_expired',
                action: 'session',
                requestId: session.requestId,
                userId: session.userId,
                url: session.url,
                details: 'Session expired automatically'
              });
            });
          });
        }
      });
    } catch (error) {
      console.warn('Error cleaning up expired sessions:', error);
    }
  }

  /**
   * Flushes batched logs to storage
   */
  function flushLogQueue() {
    if (logQueue.length === 0) return;
    
    try {
      chrome.storage.local.get([STORAGE_KEYS.AUDIT_LOGS], function(result) {
        const logs = result[STORAGE_KEYS.AUDIT_LOGS] || [];
        
        // Add all queued logs
        logs.push(...logQueue);
        
        // Keep only last 10000 logs to prevent storage bloat
        const trimmedLogs = logs.slice(-10000);
        
        chrome.storage.local.set({ [STORAGE_KEYS.AUDIT_LOGS]: trimmedLogs }, function() {
          logQueue = [];
          logFlushTimer = null;
        });
      });
    } catch (error) {
      console.warn('Error flushing log queue:', error);
      logQueue = [];
      logFlushTimer = null;
    }
  }

  /**
   * Logs an audit event (batched for performance)
   * @param {Object} eventData - Event data to log
   */
  function logAuditEvent(eventData) {
    try {
      const logEntry = {
        id: generateId(),
        timestamp: Date.now(),
        ...eventData
      };
      
      logQueue.push(logEntry);
      
      // Flush immediately if queue is full
      if (logQueue.length >= LOG_BATCH_SIZE) {
        if (logFlushTimer) {
          clearTimeout(logFlushTimer);
          logFlushTimer = null;
        }
        flushLogQueue();
      } else if (!logFlushTimer) {
        // Schedule flush after interval
        logFlushTimer = setTimeout(flushLogQueue, LOG_FLUSH_INTERVAL);
      }
    } catch (error) {
      console.warn('Error queuing audit event:', error);
    }
  }

  /**
   * Generates a unique ID
   * @returns {string} - Unique ID
   */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Generates a device fingerprint
   * @returns {string} - Device fingerprint
   */
  function generateDeviceFingerprint() {
    try {
      // Use navigator properties to create a fingerprint
      const fingerprint = [
        navigator.userAgent,
        navigator.language,
        navigator.platform,
        screen.width + 'x' + screen.height,
        new Date().getTimezoneOffset()
      ].join('|');
      
      // Create a simple hash
      let hash = 0;
      for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      
      return Math.abs(hash).toString(36);
    } catch (error) {
      // Fallback to random ID if fingerprinting fails
      return generateId();
    }
  }

  /**
   * Gets or creates device ID
   * @returns {Promise<string>} - Device ID
   */
  async function getDeviceId() {
    if (currentDeviceId) {
      return currentDeviceId;
    }
    
    return new Promise((resolve) => {
      chrome.storage.local.get(['deviceId'], async function(result) {
        if (result.deviceId) {
          currentDeviceId = result.deviceId;
          resolve(currentDeviceId);
        } else {
          // Generate new device ID using actual userId
          const userId = await getUserId();
          const fingerprint = generateDeviceFingerprint();
          const deviceId = userId + '_' + fingerprint + '_' + Date.now();
          
          currentDeviceId = deviceId;
          chrome.storage.local.set({ deviceId: deviceId }, function() {
            resolve(deviceId);
          });
        }
      });
    });
  }

  /**
   * Parses browser info from user agent
   * @returns {Object} - Browser info
   */
  function getBrowserInfo() {
    try {
      const ua = navigator.userAgent;
      let browser = 'Unknown';
      let version = '';
      
      if (ua.includes('Chrome') && !ua.includes('Edg')) {
        browser = 'Chrome';
        const match = ua.match(/Chrome\/(\d+)/);
        version = match ? match[1] : '';
      } else if (ua.includes('Firefox')) {
        browser = 'Firefox';
        const match = ua.match(/Firefox\/(\d+)/);
        version = match ? match[1] : '';
      } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
        browser = 'Safari';
        const match = ua.match(/Version\/(\d+)/);
        version = match ? match[1] : '';
      } else if (ua.includes('Edg')) {
        browser = 'Edge';
        const match = ua.match(/Edg\/(\d+)/);
        version = match ? match[1] : '';
      }
      
      return {
        name: browser,
        version: version,
        full: browser + (version ? ' ' + version : '')
      };
    } catch (error) {
      return { name: 'Unknown', version: '', full: 'Unknown' };
    }
  }

  /**
   * Parses OS info from user agent
   * @returns {string} - OS name
   */
  function getOSInfo() {
    try {
      const ua = navigator.userAgent;
      const platform = navigator.platform;
      
      if (ua.includes('Windows')) {
        if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
        if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
        if (ua.includes('Windows NT 6.2')) return 'Windows 8';
        if (ua.includes('Windows NT 6.1')) return 'Windows 7';
        return 'Windows';
      } else if (ua.includes('Mac OS X') || platform.includes('Mac')) {
        const match = ua.match(/Mac OS X (\d+)[._](\d+)/);
        if (match) {
          return 'macOS ' + match[1] + '.' + match[2];
        }
        return 'macOS';
      } else if (ua.includes('Linux') || platform.includes('Linux')) {
        return 'Linux';
      } else if (ua.includes('Android')) {
        const match = ua.match(/Android (\d+\.\d+)/);
        return match ? 'Android ' + match[1] : 'Android';
      } else if (ua.includes('iOS') || platform.includes('iPhone') || platform.includes('iPad')) {
        const match = ua.match(/OS (\d+)[._](\d+)/);
        if (match) {
          return 'iOS ' + match[1] + '.' + match[2];
        }
        return 'iOS';
      }
      
      return platform || 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Gets IP address from external API
   * @returns {Promise<string>} - IP address
   */
  function getIPAddress() {
    return new Promise((resolve) => {
      try {
        fetch('https://api.ipify.org?format=json')
          .then(response => response.json())
          .then(data => {
            resolve(data.ip || 'Unknown');
          })
          .catch(error => {
            console.warn('Error fetching IP:', error);
            resolve('Unknown');
          });
      } catch (error) {
        console.warn('Error fetching IP:', error);
        resolve('Unknown');
      }
    });
  }

  /**
   * Gets email from Chrome identity API
   * @returns {Promise<string>} - Email address
   */
  function getEmail() {
    return new Promise((resolve) => {
      try {
        chrome.identity.getProfileUserInfo(function(userInfo) {
          if (userInfo && userInfo.email) {
            resolve(userInfo.email);
          } else {
            resolve('Not available');
          }
        });
      } catch (error) {
        console.warn('Error getting email:', error);
        resolve('Not available');
      }
    });
  }

  /**
   * Gets user ID from storage (from content script)
   * Generates one if it doesn't exist (same logic as content script)
   * @returns {Promise<string>} - User ID
   */
  function getUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['userId'], function(result) {
        if (result.userId) {
          resolve(result.userId);
        } else {
          // Generate a simple user ID based on browser fingerprint (same as content script)
          const generatedUserId = 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
          chrome.storage.local.set({ userId: generatedUserId }, function() {
            resolve(generatedUserId);
          });
        }
      });
    });
  }

  /**
   * Registers or updates device information
   */
  async function registerDevice() {
    try {
      const deviceId = await getDeviceId();
      const userId = await getUserId();
      const email = await getEmail();
      const browser = getBrowserInfo();
      const os = getOSInfo();
      const ip = await getIPAddress();
      const now = Date.now();
      
      chrome.storage.local.get([STORAGE_KEYS.TRACKED_DEVICES], function(result) {
        const devices = result[STORAGE_KEYS.TRACKED_DEVICES] || [];
        
        // Find existing device
        const deviceIndex = devices.findIndex(d => d.deviceId === deviceId);
        
        const deviceData = {
          deviceId: deviceId,
          userId: userId,
          email: email,
          browser: browser.full,
          os: os,
          ip: ip,
          lastSeen: now,
          status: 'active',
          removedAt: null
        };
        
        if (deviceIndex >= 0) {
          // Update existing device
          const existing = devices[deviceIndex];
          deviceData.firstSeen = existing.firstSeen || now;
          devices[deviceIndex] = deviceData;
        } else {
          // New device
          deviceData.firstSeen = now;
          devices.push(deviceData);
          
          // Log new device registration
          logAuditEvent({
            type: 'device_registered',
            action: 'device',
            deviceId: deviceId,
            userId: userId,
            email: email,
            details: `New device registered: ${browser.full} on ${os}`
          });
        }
        
        chrome.storage.local.set({ [STORAGE_KEYS.TRACKED_DEVICES]: devices });
      });
    } catch (error) {
      console.warn('Error registering device:', error);
    }
  }

  /**
   * Checks for removed devices and marks them
   */
  function checkForRemovedDevices() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.TRACKED_DEVICES], function(result) {
        const devices = result[STORAGE_KEYS.TRACKED_DEVICES] || [];
        const now = Date.now();
        let removedCount = 0;
        
        devices.forEach((device, index) => {
          if (device.status === 'active') {
            const timeSinceLastSeen = now - device.lastSeen;
            
            if (timeSinceLastSeen > REMOVAL_THRESHOLD) {
              // Mark as removed
              devices[index] = {
                ...device,
                status: 'removed',
                removedAt: now
              };
              
              removedCount++;
              
              // Log removal event
              logAuditEvent({
                type: 'device_removed',
                action: 'device',
                deviceId: device.deviceId,
                userId: device.userId,
                email: device.email,
                details: `Device removed: ${device.browser} on ${device.os} (Last seen: ${new Date(device.lastSeen).toLocaleString()})`
              });
            }
          }
        });
        
        if (removedCount > 0) {
          chrome.storage.local.set({ [STORAGE_KEYS.TRACKED_DEVICES]: devices }, function() {
            updateRemovedDevicesBadge();
          });
        }
      });
    } catch (error) {
      console.warn('Error checking for removed devices:', error);
    }
  }

  /**
   * Updates badge with removed devices count
   */
  function updateRemovedDevicesBadge() {
    try {
      chrome.storage.local.get([STORAGE_KEYS.TRACKED_DEVICES], function(result) {
        const devices = result[STORAGE_KEYS.TRACKED_DEVICES] || [];
        const removedCount = devices.filter(d => d.status === 'removed').length;
        
        chrome.storage.local.set({ [STORAGE_KEYS.REMOVED_DEVICES_COUNT]: removedCount }, function() {
          // Update main badge (which handles both removed devices and pending requests)
          updateBadge();
        });
      });
    } catch (error) {
      console.warn('Error updating removed devices badge:', error);
    }
  }

  /**
   * Handles messages from popup/content scripts
   */
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    try {
      if (request.action === 'getPendingRequestsCount') {
        chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS], function(result) {
          const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
          const count = requests.filter(r => r.status === 'pending').length;
          sendResponse({ count: count });
        });
        return true; // Keep channel open for async response
      }
      
      if (request.action === 'addRequest') {
        chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS], function(result) {
          const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
          const newRequest = {
            id: generateId(),
            timestamp: Date.now(),
            userId: request.userId,
            url: request.url,
            duration: request.duration,
            durationType: request.durationType,
            status: 'pending',
            approvedBy: null,
            approvedAt: null,
            expiresAt: null
          };
          
          requests.push(newRequest);
          chrome.storage.local.set({ [STORAGE_KEYS.PENDING_REQUESTS]: requests }, function() {
            updateBadge();
            
            // Log the request
            logAuditEvent({
              type: 'request',
              action: 'request',
              userId: request.userId,
              url: request.url,
              requestId: newRequest.id,
              details: `Requested ${request.duration} minutes access (${request.durationType})`
            });
            
            sendResponse({ success: true, requestId: newRequest.id });
          });
        });
        return true;
      }
      
      if (request.action === 'approveRequest') {
        chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS, STORAGE_KEYS.APPROVED_SESSIONS], function(result) {
          const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
          const sessions = result[STORAGE_KEYS.APPROVED_SESSIONS] || [];
          
          const requestIndex = requests.findIndex(r => r.id === request.requestId);
          if (requestIndex === -1) {
            sendResponse({ success: false, error: 'Request not found' });
            return;
          }
          
          const req = requests[requestIndex];
          const now = Date.now();
          const expiresAt = now + (req.duration * 60 * 1000);
          
          // Update request status
          requests[requestIndex] = {
            ...req,
            status: 'approved',
            approvedBy: request.adminId || 'admin',
            approvedAt: now,
            expiresAt: expiresAt
          };
          
          // Create session
          const session = {
            requestId: req.id,
            userId: req.userId,
            url: req.url,
            expiresAt: expiresAt,
            createdAt: now
          };
          
          sessions.push(session);
          
          chrome.storage.local.set({
            [STORAGE_KEYS.PENDING_REQUESTS]: requests,
            [STORAGE_KEYS.APPROVED_SESSIONS]: sessions
          }, function() {
            // Invalidate session cache
            sessionsCache = null;
            sessionsCacheTime = 0;
            
            updateBadge();
            
            // Log the approval
            logAuditEvent({
              type: 'approval',
              action: 'approval',
              userId: req.userId,
              url: req.url,
              requestId: req.id,
              details: `Approved by ${request.adminId || 'admin'} for ${req.duration} minutes`
            });
            
            sendResponse({ success: true });
          });
        });
        return true;
      }
      
      if (request.action === 'denyRequest') {
        chrome.storage.local.get([STORAGE_KEYS.PENDING_REQUESTS], function(result) {
          const requests = result[STORAGE_KEYS.PENDING_REQUESTS] || [];
          
          const requestIndex = requests.findIndex(r => r.id === request.requestId);
          if (requestIndex === -1) {
            sendResponse({ success: false, error: 'Request not found' });
            return;
          }
          
          const req = requests[requestIndex];
          requests[requestIndex] = {
            ...req,
            status: 'denied',
            approvedBy: request.adminId || 'admin',
            approvedAt: Date.now()
          };
          
          chrome.storage.local.set({ [STORAGE_KEYS.PENDING_REQUESTS]: requests }, function() {
            updateBadge();
            
            // Log the denial
            logAuditEvent({
              type: 'denial',
              action: 'denial',
              userId: req.userId,
              url: req.url,
              requestId: req.id,
              details: `Denied by ${request.adminId || 'admin'}`
            });
            
            sendResponse({ success: true });
          });
        });
        return true;
      }
      
      if (request.action === 'checkSession') {
        const now = Date.now();
        
        // Use cache if available and fresh
        if (sessionsCache && (now - sessionsCacheTime) < SESSION_CACHE_TTL) {
          const activeSession = sessionsCache.find(s => 
            s.userId === request.userId && 
            s.url === request.url && 
            s.expiresAt > now
          );
          sendResponse({ hasSession: !!activeSession, session: activeSession || null });
          return true;
        }
        
        // Fetch from storage and cache
        chrome.storage.local.get([STORAGE_KEYS.APPROVED_SESSIONS], function(result) {
          const sessions = result[STORAGE_KEYS.APPROVED_SESSIONS] || [];
          const now = Date.now();
          
          // Filter expired sessions and cache
          const activeSessions = sessions.filter(s => s.expiresAt > now);
          sessionsCache = activeSessions;
          sessionsCacheTime = now;
          
          const activeSession = activeSessions.find(s => 
            s.userId === request.userId && 
            s.url === request.url
          );
          
          sendResponse({ hasSession: !!activeSession, session: activeSession || null });
        });
        return true;
      }
      
      if (request.action === 'logEvent') {
        logAuditEvent(request.eventData);
        sendResponse({ success: true });
        return true;
      }
      
      if (request.action === 'getDevices') {
        chrome.storage.local.get([STORAGE_KEYS.TRACKED_DEVICES], function(result) {
          const devices = result[STORAGE_KEYS.TRACKED_DEVICES] || [];
          sendResponse({ success: true, devices: devices });
        });
        return true;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  });

  // Initialize badge on startup
  updateBadge();
  
  // Register device on startup
  registerDevice();
  
  // Set up heartbeat system (every 5 minutes)
  setInterval(registerDevice, HEARTBEAT_INTERVAL);
  
  // Check for removed devices (every 1 minute)
  setInterval(checkForRemovedDevices, REMOVAL_CHECK_INTERVAL);
  
  // Update removed devices badge on startup
  updateRemovedDevicesBadge();
  
  // Clean up expired sessions every 5 minutes (less frequent)
  setInterval(cleanupExpiredSessions, 300000);
  
  // Flush log queue on extension unload
  chrome.runtime.onSuspend.addListener(function() {
    if (logQueue.length > 0) {
      flushLogQueue();
    }
  });
  
  // Listen for storage changes to update badge (more efficient than polling)
  chrome.storage.onChanged.addListener(function(changes, areaName) {
    if (areaName === 'local') {
      if (changes[STORAGE_KEYS.PENDING_REQUESTS]) {
        updateBadge();
      }
      if (changes[STORAGE_KEYS.APPROVED_SESSIONS]) {
        // Invalidate session cache
        sessionsCache = null;
        sessionsCacheTime = 0;
      }
      if (changes[STORAGE_KEYS.TRACKED_DEVICES]) {
        updateRemovedDevicesBadge();
      }
    }
  });

})();

