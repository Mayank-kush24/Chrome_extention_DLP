/**
 * Google Sheets Data Protection Content Script
 * 
 * SECURITY NOTE:
 * ==============
 * This extension is a SECURITY FRICTION LAYER, not absolute security.
 * 
 * It does NOT prevent:
 * - Screenshots (OS-level or browser extensions)
 * - Developer Tools inspection
 * - Network traffic inspection
 * - Advanced exfiltration methods
 * - Browser extensions that bypass content scripts
 * 
 * This extension is meant to:
 * - Reduce casual or accidental copying
 * - Add friction for unauthorized data extraction
 * - Work together with:
 *   - Data masking policies
 *   - Time-bound access controls
 *   - DLP solutions (Google DLP, Netwrix, etc.)
 * 
 * KNOWN LIMITATIONS:
 * ==================
 * - Can be bypassed by disabling the extension
 * - Does not prevent screenshot tools
 * - Does not prevent DevTools inspection
 * - Does not prevent browser automation tools
 * - Does not prevent screen recording
 * - Advanced users may find workarounds
 */

(function() {
  'use strict';

  // ============================================================================
  // PROTECTION STATE MANAGEMENT
  // ============================================================================
  
  const STORAGE_KEY = 'sheetsProtectionEnabled';
  const DEFAULT_STATE = true; // Protection enabled by default
  const USER_ID_KEY = 'sheetsProtectionUserId';
  
  let protectionEnabled = DEFAULT_STATE;
  let userId = null;
  let currentUrl = window.location.href;
  
  // Session cache for performance
  let sessionCache = { hasSession: false, expiresAt: 0, cacheTime: 0 };
  const SESSION_CACHE_TTL = 10000; // 10 seconds
  
  // Log queue for batching
  let logQueue = [];
  let logFlushTimer = null;
  const LOG_BATCH_SIZE = 20;
  const LOG_FLUSH_INTERVAL = 3000; // 3 seconds
  
  // Flag to prevent duplicate event listeners
  let listenersAttached = false;

  /**
   * Generates or retrieves user ID
   */
  function getUserId() {
    return new Promise((resolve) => {
      if (userId) {
        resolve(userId);
        return;
      }
      
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
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
        } else {
          resolve(null);
        }
      } catch (error) {
        console.warn('Error getting user ID:', error);
        resolve(null);
      }
    });
  }

  /**
   * Checks if user has an active approved session (cached, synchronous check first)
   */
  function hasActiveSessionSync() {
    if (!userId) {
      return false;
    }
    
    const now = Date.now();
    
    // Use cache if valid
    if (sessionCache.cacheTime && (now - sessionCache.cacheTime) < SESSION_CACHE_TTL) {
      if (sessionCache.expiresAt > now) {
        return sessionCache.hasSession;
      } else {
        return false;
      }
    }
    
    return null; // Cache expired, need async check
  }

  /**
   * Checks if user has an active approved session (async, updates cache)
   */
  function hasActiveSession() {
    return new Promise((resolve) => {
      if (!userId) {
        resolve(false);
        return;
      }
      
      const now = Date.now();
      
      // Use cache if valid
      if (sessionCache.cacheTime && (now - sessionCache.cacheTime) < SESSION_CACHE_TTL) {
        if (sessionCache.expiresAt > now) {
          resolve(sessionCache.hasSession);
        } else {
          resolve(false);
        }
        return;
      }
      
      try {
        chrome.runtime.sendMessage({
          action: 'checkSession',
          userId: userId,
          url: currentUrl
        }, function(response) {
          const hasSession = response && response.hasSession === true;
          const session = response && response.session;
          
          // Update cache
          sessionCache = {
            hasSession: hasSession,
            expiresAt: session ? session.expiresAt : 0,
            cacheTime: now
          };
          
          resolve(hasSession);
        });
      } catch (error) {
        console.warn('Error checking session:', error);
        resolve(false);
      }
    });
  }

  /**
   * Flushes batched logs
   */
  function flushLogQueue() {
    if (logQueue.length === 0) return;
    
    const logsToSend = [...logQueue];
    logQueue = [];
    logFlushTimer = null;
    
    getUserId().then(uid => {
      logsToSend.forEach(logData => {
        const fullLogData = {
          ...logData,
          userId: uid || 'unknown',
          url: currentUrl
        };
        
        chrome.runtime.sendMessage({
          action: 'logEvent',
          eventData: fullLogData
        }, function(response) {
          // Silently handle - logging should not break functionality
        });
      });
    });
  }

  /**
   * Logs an audit event (batched for performance)
   */
  function logAuditEvent(eventData) {
    try {
      logQueue.push(eventData);
      
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
      // Silently fail - logging should not break functionality
    }
  }

  /**
   * Gets cell range from selection (if applicable)
   */
  function getCellRange() {
    try {
      // Try to get selected cell range from Google Sheets
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const text = range.toString();
        // Try to extract cell references from the text
        const cellMatch = text.match(/[A-Z]+\d+/);
        if (cellMatch) {
          return cellMatch[0];
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Gets data preview (masked)
   */
  function getDataPreview(text) {
    if (!text) return null;
    const preview = text.substring(0, 50);
    // Mask sensitive data (simple masking)
    return preview.replace(/[a-zA-Z0-9]/g, (char, index) => {
      if (index < 2) return char;
      return '*';
    });
  }

  /**
   * Loads protection state from storage
   */
  function loadProtectionState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get([STORAGE_KEY], function(result) {
          protectionEnabled = result[STORAGE_KEY] !== undefined 
            ? result[STORAGE_KEY] 
            : DEFAULT_STATE;
        });
      }
    } catch (error) {
      console.warn('Error loading protection state:', error);
      protectionEnabled = DEFAULT_STATE;
    }
  }

  /**
   * Checks if protection is currently enabled
   * @returns {boolean} - True if protection is enabled
   */
  function isProtectionEnabled() {
    return protectionEnabled;
  }

  /**
   * Updates protection state (called from popup via message)
   * @param {boolean} enabled - Whether protection should be enabled
   */
  function updateProtectionState(enabled) {
    protectionEnabled = enabled;
    
    // Update CSS styles based on state
    updateProtectionStyles(enabled);
  }

  /**
   * Updates CSS styles based on protection state
   * @param {boolean} enabled - Whether protection is enabled
   */
  function updateProtectionStyles(enabled) {
    try {
      const style = document.getElementById('sheets-protection-style');
      if (style) {
        if (enabled) {
          style.textContent = `
            body:not([contenteditable="true"]) *:not(input):not(textarea):not([contenteditable="true"]) {
              -webkit-user-select: none !important;
              -moz-user-select: none !important;
              -ms-user-select: none !important;
              user-select: none !important;
            }
            input, textarea, [contenteditable="true"] {
              -webkit-user-select: text !important;
              -moz-user-select: text !important;
              -ms-user-select: text !important;
              user-select: text !important;
            }
          `;
        } else {
          style.textContent = `
            /* Protection disabled - allow all selection */
          `;
        }
      }
    } catch (error) {
      console.warn('Error updating protection styles:', error);
    }
  }

  // Listen for messages from popup to update protection state
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'updateProtectionState') {
          updateProtectionState(request.enabled);
          sendResponse({ success: true });
        }
        return true; // Keep message channel open for async response
      });
    }
  } catch (error) {
    console.warn('Error setting up message listener:', error);
  }

  // ============================================================================
  // TOAST NOTIFICATION SYSTEM
  // ============================================================================
  
  /**
   * Creates and shows a non-intrusive toast notification
   * @param {string} message - The message to display
   */
  function showToast(message) {
    try {
      // Remove existing toast if present
      const existingToast = document.getElementById('sheets-protection-toast');
      if (existingToast) {
        existingToast.remove();
      }

      // Create toast element
      const toast = document.createElement('div');
      toast.id = 'sheets-protection-toast';
      toast.textContent = message;
      
      // Style the toast (inline styles to avoid external dependencies)
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: '#ea4335',
        color: 'white',
        padding: '12px 20px',
        borderRadius: '4px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        zIndex: '999999',
        fontSize: '14px',
        fontFamily: 'Roboto, Arial, sans-serif',
        fontWeight: '500',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 0.3s ease-in-out',
        maxWidth: '300px',
        wordWrap: 'break-word'
      });

      // Append to document body (or documentElement if body not ready)
      const target = document.body || document.documentElement;
      target.appendChild(toast);

      // Trigger fade-in animation
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
      });

      // Auto-remove after 3 seconds
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 300);
      }, 3000);
    } catch (error) {
      // Silently fail if toast cannot be shown
      console.warn('Failed to show toast:', error);
    }
  }

  // ============================================================================
  // KEYBOARD SHORTCUT BLOCKING
  // ============================================================================

  /**
   * Checks if a keyboard event is a blocked shortcut
   * @param {KeyboardEvent} event - The keyboard event
   * @returns {boolean} - True if the shortcut should be blocked
   */
  function isBlockedShortcut(event) {
    // Check for Ctrl (Windows/Linux) or Cmd (macOS)
    const isModifierPressed = event.ctrlKey || event.metaKey;
    
    if (!isModifierPressed) {
      return false;
    }

    const key = event.key.toLowerCase();
    
    // Block: Ctrl+C / Cmd+C (Copy)
    if (key === 'c' && !event.shiftKey) {
      return true;
    }
    
    // Block: Ctrl+X / Cmd+X (Cut)
    if (key === 'x' && !event.shiftKey) {
      return true;
    }
    
    // Block: Ctrl+A / Cmd+A (Select All)
    if (key === 'a' && !event.shiftKey) {
      return true;
    }
    
    // Block: Ctrl+V / Cmd+V (Paste) - optional but preferred
    if (key === 'v' && !event.shiftKey) {
      return true;
    }

    return false;
  }

  /**
   * Handles keyboard events to block shortcuts
   * Uses capture phase to intercept before Google Sheets handlers
   */
  async function handleKeyDown(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      // Allow normal typing - only block modifier key combinations
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      // Check if this is a blocked shortcut
      if (isBlockedShortcut(event)) {
        const key = event.key.toLowerCase();
        const action = key === 'c' ? 'copy' : key === 'x' ? 'cut' : key === 'a' ? 'select' : key === 'v' ? 'paste' : 'unknown';
        
        // For copy/cut, also check if we're in an editable element
        if (key === 'c' || key === 'x') {
          const activeElement = document.activeElement;
          if (activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
          )) {
            // Check if there's a selection within the editable element
            if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
              const start = activeElement.selectionStart;
              const end = activeElement.selectionEnd;
              if (start !== null && end !== null && start !== end) {
                // Allow copy/cut within input field - no logging needed
                return;
              }
            } else if (activeElement.isContentEditable) {
              // For contentEditable, check if selection is within it
              if (shouldAllowCopy()) {
                // Allow - no logging needed
                return;
              }
            }
          }
        }
        
        // Check for active session (synchronous check first for performance)
        const cachedSession = hasActiveSessionSync();
        if (cachedSession === true) {
          // Allow if session is active - no logging needed
          return;
        } else if (cachedSession === null) {
          // Cache expired, do async check
          const hasSession = await hasActiveSession();
          if (hasSession) {
            // Allow if session is active - no logging needed
            return;
          }
        }
        
        // Block the action
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Log the blocked attempt
        const cellRange = getCellRange();
        const selection = window.getSelection();
        const dataPreview = selection && selection.toString() ? getDataPreview(selection.toString()) : null;
        
        logAuditEvent({
          type: 'blocked',
          action: action,
          cellRange: cellRange,
          dataPreview: dataPreview,
          details: `Blocked ${action} attempt via keyboard shortcut`
        });
        
        // Show warning toast
        showToast('Copying data from this sheet is restricted.');
        
        return false;
      }
    } catch (error) {
      // Silently fail to avoid breaking Google Sheets
      console.warn('Error in handleKeyDown:', error);
    }
  }

  /**
   * Handles keyup events to ensure shortcuts are fully blocked
   */
  function handleKeyUp(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      if (isBlockedShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return false;
      }
    } catch (error) {
      console.warn('Error in handleKeyUp:', error);
    }
  }

  // ============================================================================
  // RIGHT-CLICK CONTEXT MENU BLOCKING
  // ============================================================================

  /**
   * Blocks right-click context menu
   * Uses capture phase to intercept before default behavior
   */
  async function handleContextMenu(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      // Check for active session (synchronous check first for performance)
      const cachedSession = hasActiveSessionSync();
      if (cachedSession === true) {
        // Allow right-click if session is active
        return;
      } else if (cachedSession === null) {
        // Cache expired, do async check
        const hasSession = await hasActiveSession();
        if (hasSession) {
          // Allow right-click if session is active
          return;
        }
      }

      // Block all right-click events
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Log the blocked attempt
      logAuditEvent({
        type: 'blocked',
        action: 'contextmenu',
        details: 'Blocked right-click context menu'
      });
      
      // Show warning toast
      showToast('Copying data from this sheet is restricted.');
      
      return false;
    } catch (error) {
      console.warn('Error in handleContextMenu:', error);
    }
  }

  // ============================================================================
  // TEXT SELECTION BLOCKING
  // ============================================================================

  /**
   * Blocks text selection via mouse drag
   * Uses capture phase to intercept selection events
   */
  function handleSelectStart(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      // Allow selection inside input/textarea elements (for editing cells)
      const target = event.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        // Allow selection within editable elements
        return;
      }

      // Block selection for all other elements
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      return false;
    } catch (error) {
      console.warn('Error in handleSelectStart:', error);
    }
  }

  /**
   * Blocks text selection via mouse drag (mousedown + mousemove)
   * This handles drag selection that selectstart might miss
   */
  let isMouseDown = false;
  let mouseDownTarget = null;

  function handleMouseDown(event) {
    try {
      // Track mouse down for potential drag selection
      isMouseDown = true;
      mouseDownTarget = event.target;
      
      // Allow mouse down in editable elements
      if (mouseDownTarget && (
        mouseDownTarget.tagName === 'INPUT' ||
        mouseDownTarget.tagName === 'TEXTAREA' ||
        mouseDownTarget.isContentEditable
      )) {
        return;
      }
    } catch (error) {
      console.warn('Error in handleMouseDown:', error);
    }
  }

  // REMOVED: handleMouseMove - This was causing severe performance issues
  // mousemove fires constantly (hundreds of times per second) and was slowing down Chrome
  // Selection blocking is already handled by selectstart and select events
  function handleMouseMove(event) {
    // Disabled for performance - selection blocking handled by selectstart/select events
    return;
  }

  function handleMouseUp(event) {
    try {
      // Reset mouse down state
      isMouseDown = false;
      mouseDownTarget = null;
      
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }
      
      // Clear any selection that might have been made
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          // Allow selection in editable elements
          const target = event.target;
          if (target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
          )) {
            return;
          }
          
          // Clear selection for other elements
          selection.removeAllRanges();
        }
      }
    } catch (error) {
      console.warn('Error in handleMouseUp:', error);
    }
  }

  /**
   * Blocks selection changes via select event
   */
  function handleSelect(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      const target = event.target;
      
      // Allow selection in editable elements
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return;
      }

      // Block selection for other elements
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          // Check if selection is within an editable element
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          
          // Allow if selection is within editable content
          let node = container.nodeType === 1 ? container : container.parentNode;
          while (node && node !== document.body) {
            if (node.isContentEditable || 
                node.tagName === 'INPUT' || 
                node.tagName === 'TEXTAREA') {
              return;
            }
            node = node.parentNode;
          }
          
          // Block selection
          selection.removeAllRanges();
          event.preventDefault();
          event.stopPropagation();
        }
      }
    } catch (error) {
      console.warn('Error in handleSelect:', error);
    }
  }

  // ============================================================================
  // COPY/PASTE EVENT BLOCKING
  // ============================================================================

  /**
   * Checks if copy should be allowed from the current context
   * @returns {boolean} - True if copy should be allowed
   */
  function shouldAllowCopy() {
    try {
      // Check if there's an active selection
      if (window.getSelection) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const container = range.commonAncestorContainer;
          let node = container.nodeType === 1 ? container : container.parentNode;
          
          // Check if selection is within an editable element
          while (node && node !== document.body && node !== document.documentElement) {
            if (node.tagName === 'INPUT' || 
                node.tagName === 'TEXTAREA' || 
                node.isContentEditable) {
              // Check if the entire selection is within this editable element
              const editableRect = node.getBoundingClientRect();
              const rangeRect = range.getBoundingClientRect();
              
              // Allow if selection is completely within the editable element
              if (rangeRect.left >= editableRect.left &&
                  rangeRect.right <= editableRect.right &&
                  rangeRect.top >= editableRect.top &&
                  rangeRect.bottom <= editableRect.bottom) {
                return true;
              }
            }
            node = node.parentNode;
          }
        }
      }
      
      // Check active element
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      )) {
        // Only allow if we're copying text that's actually selected within the input
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
          const start = activeElement.selectionStart;
          const end = activeElement.selectionEnd;
          // Allow if there's a selection within the input field itself
          if (start !== null && end !== null && start !== end) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Error checking copy allowance:', error);
      return false;
    }
  }

  /**
   * Blocks copy events (including menu actions)
   */
  async function handleCopy(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      // Check if copy should be allowed (only from editable elements)
      if (shouldAllowCopy()) {
        // Allow - no logging needed for performance
        return;
      }

      // Check for active session (synchronous check first for performance)
      const cachedSession = hasActiveSessionSync();
      if (cachedSession === true) {
        // Allow if session is active - no logging needed
        return;
      } else if (cachedSession === null) {
        // Cache expired, do async check
        const hasSession = await hasActiveSession();
        if (hasSession) {
          // Allow if session is active - no logging needed
          return;
        }
      }

      // Block copy from non-editable areas
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Clear clipboard data aggressively
      if (event.clipboardData) {
        try {
          event.clipboardData.setData('text/plain', '');
          event.clipboardData.setData('text/html', '');
        } catch (e) {
          // Some browsers may restrict clipboard access
        }
      }
      
      // Also try to clear via execCommand (legacy support)
      try {
        document.execCommand('copy', false, null);
      } catch (e) {
        // Ignore errors
      }
      
      // Log the blocked attempt
      const cellRange = getCellRange();
      const selection = window.getSelection();
      const dataPreview = selection && selection.toString() ? getDataPreview(selection.toString()) : null;
      
      logAuditEvent({
        type: 'blocked',
        action: 'copy',
        cellRange: cellRange,
        dataPreview: dataPreview,
        details: 'Blocked copy attempt'
      });
      
      // Show warning toast
      showToast('Copying data from this sheet is restricted.');
      
      return false;
    } catch (error) {
      console.warn('Error in handleCopy:', error);
      // Even on error, try to block
      try {
        event.preventDefault();
        event.stopPropagation();
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Blocks cut events
   */
  async function handleCut(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      const target = event.target;
      
      // Allow cut from editable elements (for normal editing)
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        // Allow - no logging needed for performance
        return;
      }

      // Check for active session (synchronous check first for performance)
      const cachedSession = hasActiveSessionSync();
      if (cachedSession === true) {
        // Allow if session is active - no logging needed
        return;
      } else if (cachedSession === null) {
        // Cache expired, do async check
        const hasSession = await hasActiveSession();
        if (hasSession) {
          // Allow if session is active - no logging needed
          return;
        }
      }

      // Block cut from non-editable areas
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Clear clipboard data
      if (event.clipboardData) {
        event.clipboardData.clearData();
      }
      
      // Log the blocked attempt
      const cellRange = getCellRange();
      const selection = window.getSelection();
      const dataPreview = selection && selection.toString() ? getDataPreview(selection.toString()) : null;
      
      logAuditEvent({
        type: 'blocked',
        action: 'cut',
        cellRange: cellRange,
        dataPreview: dataPreview,
        details: 'Blocked cut attempt'
      });
      
      // Show warning toast
      showToast('Copying data from this sheet is restricted.');
      
      return false;
    } catch (error) {
      console.warn('Error in handleCut:', error);
    }
  }

  /**
   * Blocks paste events (optional, but preferred per requirements)
   */
  async function handlePaste(event) {
    try {
      // Check if protection is enabled
      if (!isProtectionEnabled()) {
        return;
      }

      const target = event.target;
      
      // Allow paste into editable elements (for normal editing)
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        // Allow - no logging needed for performance
        return;
      }

      // Check for active session (synchronous check first for performance)
      const cachedSession = hasActiveSessionSync();
      if (cachedSession === true) {
        // Allow if session is active - no logging needed
        return;
      } else if (cachedSession === null) {
        // Cache expired, do async check
        const hasSession = await hasActiveSession();
        if (hasSession) {
          // Allow if session is active - no logging needed
          return;
        }
      }

      // Block paste into non-editable areas
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Log the blocked attempt
      logAuditEvent({
        type: 'blocked',
        action: 'paste',
        details: 'Blocked paste attempt'
      });
      
      // Show warning toast
      showToast('Copying data from this sheet is restricted.');
      
      return false;
    } catch (error) {
      console.warn('Error in handlePaste:', error);
    }
  }

  // ============================================================================
  // EVENT LISTENER SETUP
  // ============================================================================

  /**
   * Sets up all event listeners using capture phase
   * This ensures we intercept events before Google Sheets handlers
   * Optimized: Only attach to document, prevent duplicates, remove expensive listeners
   */
  function setupEventListeners() {
    try {
      // Prevent duplicate listeners
      if (listenersAttached) {
        return;
      }
      listenersAttached = true;
      
      // Keyboard shortcuts - only document (more efficient)
      document.addEventListener('keydown', handleKeyDown, true); // capture phase
      document.addEventListener('keyup', handleKeyUp, true); // capture phase
      
      // Right-click context menu
      document.addEventListener('contextmenu', handleContextMenu, true); // capture phase
      
      // Text selection blocking - REMOVED mousemove (causes performance issues)
      document.addEventListener('selectstart', handleSelectStart, true); // capture phase
      document.addEventListener('select', handleSelect, true); // capture phase
      document.addEventListener('mousedown', handleMouseDown, true); // capture phase
      // REMOVED: mousemove - fires too frequently, causes severe slowdown
      document.addEventListener('mouseup', handleMouseUp, true); // capture phase
      
      // Copy/Cut/Paste blocking
      document.addEventListener('copy', handleCopy, true); // capture phase
      document.addEventListener('cut', handleCut, true); // capture phase
      document.addEventListener('paste', handlePaste, true); // capture phase
      
      // REMOVED: beforeinput listener - not needed, copy/paste events handle it
      
      // Also block selection via CSS (additional layer)
      // This prevents visual selection highlighting
      const style = document.createElement('style');
      style.id = 'sheets-protection-style';
      
      // Inject style into document head (or documentElement if head not ready)
      const head = document.head || document.documentElement;
      head.appendChild(style);
      
      // Update styles based on current protection state
      updateProtectionStyles(protectionEnabled);
      
    } catch (error) {
      console.warn('Error setting up event listeners:', error);
    }
  }

  // ============================================================================
  // CLIPBOARD API INTERCEPTION
  // ============================================================================

  /**
   * Intercepts Clipboard API to block copy operations
   * This catches programmatic clipboard access that bypasses events
   * Note: Modern browsers make Clipboard API read-only, so this may not work in all cases.
   * Event-based blocking (copy/cut/paste events) is the primary protection mechanism.
   */
  function interceptClipboardAPI() {
    try {
      if (!navigator || !navigator.clipboard) {
        return;
      }

      // Store original clipboard methods if not already stored
      if (!window._sheetsProtectionOriginalClipboard) {
        try {
          window._sheetsProtectionOriginalClipboard = {
            writeText: navigator.clipboard.writeText,
            readText: navigator.clipboard.readText,
            write: navigator.clipboard.write,
            read: navigator.clipboard.read
          };
        } catch (e) {
          // Clipboard API may not be accessible
          return;
        }
      }

      const original = window._sheetsProtectionOriginalClipboard;

      // Try to override writeText - may fail if read-only
      // Optimized: Use synchronous session check first
      try {
        if (original.writeText) {
          navigator.clipboard.writeText = function(text) {
            // Use synchronous check first for performance
            const cachedSession = hasActiveSessionSync();
            if (cachedSession === true) {
              return original.writeText.call(navigator.clipboard, text);
            } else if (cachedSession === false) {
              if (isProtectionEnabled() && !shouldAllowCopy()) {
                showToast('Copying data from this sheet is restricted.');
                return Promise.reject(new DOMException('Copy operation blocked', 'NotAllowedError'));
              }
              return original.writeText.call(navigator.clipboard, text);
            } else {
              // Cache expired, do async check
              return hasActiveSession().then(hasSession => {
                if (isProtectionEnabled() && !hasSession && !shouldAllowCopy()) {
                  showToast('Copying data from this sheet is restricted.');
                  return Promise.reject(new DOMException('Copy operation blocked', 'NotAllowedError'));
                }
                return original.writeText.call(navigator.clipboard, text);
              });
            }
          };
        }
      } catch (e) {
        // Clipboard API is read-only - this is expected in modern browsers
        // Event-based blocking will handle most cases
      }

      // Try to override write - may fail if read-only
      try {
        if (original.write) {
          navigator.clipboard.write = function(data) {
            // Use synchronous check first for performance
            const cachedSession = hasActiveSessionSync();
            if (cachedSession === true) {
              return original.write.call(navigator.clipboard, data);
            } else if (cachedSession === false) {
              if (isProtectionEnabled() && !shouldAllowCopy()) {
                showToast('Copying data from this sheet is restricted.');
                return Promise.reject(new DOMException('Copy operation blocked', 'NotAllowedError'));
              }
              return original.write.call(navigator.clipboard, data);
            } else {
              // Cache expired, do async check
              return hasActiveSession().then(hasSession => {
                if (isProtectionEnabled() && !hasSession && !shouldAllowCopy()) {
                  showToast('Copying data from this sheet is restricted.');
                  return Promise.reject(new DOMException('Copy operation blocked', 'NotAllowedError'));
                }
                return original.write.call(navigator.clipboard, data);
              });
            }
          };
        }
      } catch (e) {
        // Clipboard API is read-only - this is expected
      }

      // Try to override readText - may fail if read-only
      try {
        if (original.readText) {
          navigator.clipboard.readText = function() {
            // Use synchronous check first for performance
            const cachedSession = hasActiveSessionSync();
            if (cachedSession === true) {
              return original.readText.call(navigator.clipboard);
            } else if (cachedSession === false) {
              if (isProtectionEnabled()) {
                const activeElement = document.activeElement;
                if (!activeElement || (
                  activeElement.tagName !== 'INPUT' &&
                  activeElement.tagName !== 'TEXTAREA' &&
                  !activeElement.isContentEditable
                )) {
                  showToast('Copying data from this sheet is restricted.');
                  return Promise.reject(new DOMException('Paste operation blocked', 'NotAllowedError'));
                }
              }
              return original.readText.call(navigator.clipboard);
            } else {
              // Cache expired, do async check
              return hasActiveSession().then(hasSession => {
                if (isProtectionEnabled() && !hasSession) {
                  const activeElement = document.activeElement;
                  if (!activeElement || (
                    activeElement.tagName !== 'INPUT' &&
                    activeElement.tagName !== 'TEXTAREA' &&
                    !activeElement.isContentEditable
                  )) {
                    showToast('Copying data from this sheet is restricted.');
                    return Promise.reject(new DOMException('Paste operation blocked', 'NotAllowedError'));
                  }
                }
                return original.readText.call(navigator.clipboard);
              });
            }
          };
        }
      } catch (e) {
        // Clipboard API is read-only - this is expected
      }

      // Try to override read - may fail if read-only
      try {
        if (original.read) {
          navigator.clipboard.read = function() {
            // Use synchronous check first for performance
            const cachedSession = hasActiveSessionSync();
            if (cachedSession === true) {
              return original.read.call(navigator.clipboard);
            } else if (cachedSession === false) {
              if (isProtectionEnabled()) {
                const activeElement = document.activeElement;
                if (!activeElement || (
                  activeElement.tagName !== 'INPUT' &&
                  activeElement.tagName !== 'TEXTAREA' &&
                  !activeElement.isContentEditable
                )) {
                  showToast('Copying data from this sheet is restricted.');
                  return Promise.reject(new DOMException('Paste operation blocked', 'NotAllowedError'));
                }
              }
              return original.read.call(navigator.clipboard);
            } else {
              // Cache expired, do async check
              return hasActiveSession().then(hasSession => {
                if (isProtectionEnabled() && !hasSession) {
                  const activeElement = document.activeElement;
                  if (!activeElement || (
                    activeElement.tagName !== 'INPUT' &&
                    activeElement.tagName !== 'TEXTAREA' &&
                    !activeElement.isContentEditable
                  )) {
                    showToast('Copying data from this sheet is restricted.');
                    return Promise.reject(new DOMException('Paste operation blocked', 'NotAllowedError'));
                  }
                }
                return original.read.call(navigator.clipboard);
              });
            }
          };
        }
      } catch (e) {
        // Clipboard API is read-only - this is expected
      }
    } catch (error) {
      // Silently fail - event-based blocking is the primary mechanism
      // Clipboard API interception is a best-effort additional layer
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the protection when DOM is ready
   * Handles both immediate execution and delayed DOM loading
   */
  function init() {
    try {
      // Initialize user ID
      getUserId();
      
      // Load protection state from storage first
      loadProtectionState();
      
      // Intercept Clipboard API immediately
      interceptClipboardAPI();
      
      // Set up listeners only once
      if (document.readyState === 'loading') {
        // DOM not ready yet, wait for it
        document.addEventListener('DOMContentLoaded', setupEventListeners);
      } else {
        // DOM already ready, set up immediately
        setupEventListeners();
      }
      
      // REMOVED: Duplicate setupEventListeners() call - was causing duplicate listeners
      
      // Flush logs on page unload
      window.addEventListener('beforeunload', function() {
        if (logQueue.length > 0) {
          flushLogQueue();
        }
      });
      
      // Note: Clipboard API interception may not work in all browsers due to read-only properties
      // Event-based blocking (copy/cut/paste events) is the primary protection mechanism
      
      // Handle dynamic content loading (Google Sheets loads content dynamically)
      // Optimized: Only observe head element, not entire document (much more efficient)
      const observer = new MutationObserver(function(mutations) {
        // Only check if style was removed, don't process all mutations
        const style = document.getElementById('sheets-protection-style');
        if (!style) {
          // Re-inject style with current protection state
          const newStyle = document.createElement('style');
          newStyle.id = 'sheets-protection-style';
          const head = document.head || document.documentElement;
          head.appendChild(newStyle);
          updateProtectionStyles(protectionEnabled);
        }
      });
      
      // Only observe head element (much more efficient than entire document)
      if (document.head) {
        observer.observe(document.head, {
          childList: true  // Only watch for child additions/removals in head
        });
      }
      
    } catch (error) {
      console.warn('Error initializing protection:', error);
    }
  }

  // Start initialization
  init();

})();

