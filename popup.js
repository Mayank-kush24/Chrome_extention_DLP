/**
 * Popup UI Script
 * Handles the toggle state and UI updates
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'sheetsProtectionEnabled';
  const DEFAULT_STATE = true; // Protection enabled by default
  const USER_ID_KEY = 'sheetsProtectionUserId';
  const ADMIN_SESSION_KEY = 'isAdminSession';

  const toggle = document.getElementById('protectionToggle');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const requestButton = document.getElementById('requestAccessButton');
  const requestForm = document.getElementById('requestForm');
  const requestArrow = document.getElementById('requestArrow');
  const durationOptions = document.querySelectorAll('.duration-option');
  const customDuration = document.getElementById('customDuration');
  const customDurationInput = document.getElementById('customDurationInput');
  const submitRequest = document.getElementById('submitRequest');
  const requestStatus = document.getElementById('requestStatus');
  const sessionInfo = document.getElementById('sessionInfo');
  const adminConsoleButton = document.getElementById('adminConsoleButton');

  let selectedDuration = null;
  let selectedDurationType = null;
  let userId = null;

  /**
   * Updates the UI to reflect the current protection state
   * @param {boolean} enabled - Whether protection is enabled
   */
  function updateUI(enabled) {
    toggle.checked = enabled;
    
    if (enabled) {
      statusIndicator.className = 'status-indicator active';
      statusText.textContent = 'Protection Active';
    } else {
      statusIndicator.className = 'status-indicator inactive';
      statusText.textContent = 'Protection Disabled';
    }
  }

  /**
   * Loads the current protection state from storage
   */
  function loadState() {
    try {
      chrome.storage.local.get([STORAGE_KEY], function(result) {
        const enabled = result[STORAGE_KEY] !== undefined 
          ? result[STORAGE_KEY] 
          : DEFAULT_STATE;
        updateUI(enabled);
      });
    } catch (error) {
      console.error('Error loading state:', error);
      updateUI(DEFAULT_STATE);
    }
  }

  /**
   * Saves the protection state to storage
   * @param {boolean} enabled - Whether protection should be enabled
   */
  function saveState(enabled) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: enabled }, function() {
        updateUI(enabled);
        
        // Notify all Google Sheets tabs to update their protection state
        notifyContentScripts(enabled);
      });
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  /**
   * Notifies all Google Sheets content scripts to update their protection state
   * @param {boolean} enabled - Whether protection should be enabled
   */
  function notifyContentScripts(enabled) {
    try {
      chrome.tabs.query(
        { url: 'https://docs.google.com/spreadsheets/*' },
        function(tabs) {
          if (!tabs || tabs.length === 0) {
            // No Google Sheets tabs open, which is fine
            return;
          }

          tabs.forEach(function(tab) {
            // Check if tab is accessible before sending message
            if (!tab.id || !tab.url) {
              return;
            }

            // Try to send message with better error handling
            chrome.tabs.sendMessage(tab.id, {
              action: 'updateProtectionState',
              enabled: enabled
            }).catch(function(error) {
              // Only log if it's not the expected "receiving end does not exist" error
              // This happens when:
              // 1. Content script hasn't loaded yet (expected)
              // 2. Tab was closed/navigated away (expected)
              // 3. Content script was removed (expected)
              const errorMessage = error && error.message ? error.message : String(error);
              const isExpectedError = 
                errorMessage.includes('Receiving end does not exist') ||
                errorMessage.includes('Could not establish connection') ||
                errorMessage.includes('Extension context invalidated');
              
              // Only log unexpected errors
              if (!isExpectedError) {
                console.warn('Unexpected error notifying tab:', error);
              }
              // Expected errors are silently ignored - this is normal behavior
            });
          });
        }
      );
    } catch (error) {
      // Only log actual errors, not expected connection issues
      console.error('Error querying tabs:', error);
    }
  }

  /**
   * Handles toggle change event
   */
  function handleToggleChange() {
    const enabled = toggle.checked;
    saveState(enabled);
  }

  /**
   * Generates or retrieves user ID
   */
  function getUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get([USER_ID_KEY], function(result) {
        if (result[USER_ID_KEY]) {
          userId = result[USER_ID_KEY];
          resolve(userId);
        } else {
          // Generate a simple user ID based on browser fingerprint
          userId = 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
          chrome.storage.local.set({ [USER_ID_KEY]: userId }, function() {
            resolve(userId);
          });
        }
      });
    });
  }

  /**
   * Checks if user is admin
   */
  function checkAdminStatus() {
    chrome.storage.local.get([ADMIN_SESSION_KEY], function(result) {
      if (result[ADMIN_SESSION_KEY]) {
        adminConsoleButton.classList.add('visible');
      } else {
        adminConsoleButton.classList.remove('visible');
      }
    });
  }

  /**
   * Gets current tab URL
   */
  function getCurrentTabUrl() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs && tabs[0] && tabs[0].url) {
          resolve(tabs[0].url);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Handles request form expansion
   */
  function toggleRequestForm() {
    requestForm.classList.toggle('expanded');
    requestArrow.textContent = requestForm.classList.contains('expanded') ? '▲' : '▼';
  }

  /**
   * Handles duration selection
   */
  function selectDuration(option) {
    durationOptions.forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    
    const duration = option.dataset.duration;
    const type = option.dataset.type;
    
    if (duration === 'custom') {
      customDuration.classList.add('visible');
      selectedDuration = null;
      selectedDurationType = 'custom';
    } else {
      customDuration.classList.remove('visible');
      selectedDuration = parseInt(duration);
      selectedDurationType = type;
    }
  }

  /**
   * Submits a request
   */
  async function submitAccessRequest() {
    if (!selectedDuration && selectedDurationType !== 'custom') {
      alert('Please select a duration');
      return;
    }

    let duration = selectedDuration;
    if (selectedDurationType === 'custom') {
      duration = parseInt(customDurationInput.value);
      if (!duration || duration < 1 || duration > 1440) {
        alert('Please enter a valid duration between 1 and 1440 minutes');
        return;
      }
    }

    const url = await getCurrentTabUrl();
    if (!url || !url.includes('docs.google.com/spreadsheets')) {
      alert('Please open a Google Sheets page to request access');
      return;
    }

    submitRequest.disabled = true;
    submitRequest.textContent = 'Submitting...';

    chrome.runtime.sendMessage({
      action: 'addRequest',
      userId: userId,
      url: url,
      duration: duration,
      durationType: selectedDurationType
    }, function(response) {
      submitRequest.disabled = false;
      submitRequest.textContent = 'Submit Request';
      
      if (response && response.success) {
        requestStatus.textContent = 'Request submitted successfully. Waiting for admin approval...';
        requestStatus.className = 'request-status visible pending';
        checkRequestStatus();
      } else {
        alert('Failed to submit request. Please try again.');
      }
    });
  }

  /**
   * Checks request status
   */
  function checkRequestStatus() {
    chrome.storage.local.get(['pendingRequests', 'approvedSessions'], function(result) {
      const requests = result.pendingRequests || [];
      const sessions = result.approvedSessions || [];
      const now = Date.now();
      
      // Check for pending requests
      const userRequests = requests.filter(r => r.userId === userId);
      const pendingRequest = userRequests.find(r => r.status === 'pending');
      
      if (pendingRequest) {
        requestStatus.textContent = 'Request pending approval...';
        requestStatus.className = 'request-status visible pending';
      } else {
        const approvedRequest = userRequests.find(r => r.status === 'approved');
        const deniedRequest = userRequests.find(r => r.status === 'denied');
        
        if (approvedRequest) {
          // Check if session is still active
          const activeSession = sessions.find(s => 
            s.userId === userId && 
            s.requestId === approvedRequest.id &&
            s.expiresAt > now
          );
          
          if (activeSession) {
            const timeLeft = Math.floor((activeSession.expiresAt - now) / 1000 / 60);
            sessionInfo.textContent = `Active session: ${timeLeft} minutes remaining`;
            sessionInfo.className = 'session-info visible';
            requestStatus.className = 'request-status';
          } else {
            requestStatus.textContent = 'Your request was approved but has expired.';
            requestStatus.className = 'request-status visible denied';
            sessionInfo.className = 'session-info';
          }
        } else if (deniedRequest) {
          requestStatus.textContent = 'Your request was denied.';
          requestStatus.className = 'request-status visible denied';
          sessionInfo.className = 'session-info';
        } else {
          requestStatus.className = 'request-status';
          sessionInfo.className = 'session-info';
        }
      }
    });
  }

  /**
   * Opens admin console
   */
  function openAdminConsole() {
    chrome.tabs.create({ url: chrome.runtime.getURL('admin.html') });
  }

  // Initialize
  toggle.addEventListener('change', handleToggleChange);
  requestButton.addEventListener('click', toggleRequestForm);
  submitRequest.addEventListener('click', submitAccessRequest);
  adminConsoleButton.addEventListener('click', openAdminConsole);
  
  durationOptions.forEach(option => {
    option.addEventListener('click', () => selectDuration(option));
  });

  // Initialize user ID and check admin status
  getUserId().then(() => {
    loadState();
    checkAdminStatus();
    checkRequestStatus();
    
    // Refresh request status every 10 seconds (less frequent)
    setInterval(checkRequestStatus, 10000);
  });

})();

