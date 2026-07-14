/**
 * BlockForge - Enhanced Popup Script
 * Shows per-site stats and allows unblocking specific items
 */

// Global state
let currentTab = null;
let currentHostname = '';
let isEnabled = true;
let siteBlocked = [];
let siteAllowed = [];
let siteExceptions = [];
let currentTabStats = null;

// Initialize
// Security: HTML Sanitizer
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
  await initialize();
  setupEventListeners();
  setupTabs();
});

/**
 * Initialize popup
 */
async function initialize() {
  try {
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    
    // Get hostname
    if (currentTab?.url) {
      try {
        const url = new URL(currentTab.url);
        currentHostname = url.hostname;
        document.getElementById('hostname').textContent = currentHostname || 'New Tab';
      } catch {
        document.getElementById('hostname').textContent = 'Browser Page';
      }
    }
    
    // Load all data
    await loadStatus();
    await loadSiteData();
    await loadBlockedItems();
    
  } catch (error) {
    console.error('Init error:', error);
    showToast('Failed to initialize', 'error');
  }
}

/**
 * Load global status
 */
async function loadStatus() {
  try {
    const response = await safeSendMessage({ action: 'getStatus' });
    
    if (response) {
      isEnabled = response.isEnabled !== false;
      updatePowerButton();
      updateGlobalStats(response.statistics || {});
    }
  } catch (error) {
    console.error('Status error:', error);
    showToast('Failed to load status', 'error');
  }
}

/**
 * Load site-specific data
 */
async function loadSiteData() {
  try {
    // Check if site is whitelisted
    const response = await safeSendMessage({ action: 'getSettings' });
    const settings = response?.settings || {};
    const whitelist = settings.whitelist || [];
    
    const isWhitelisted = whitelist.includes(currentHostname);
    updateSiteStatus(isWhitelisted);
    
    ['Ads', 'Trackers', 'Miners', 'Fingerprint', 'Annoyances', 'OTA'].forEach(setting => {
      const toggle = document.getElementById(`toggle${setting}`);
      if (toggle) {
        let key = `block${setting}`;
        if (setting === 'Fingerprint') key = 'antiFingerprint';
        if (setting === 'Annoyances') key = 'blockAnnoyances';
        if (setting === 'OTA') key = 'otaEnabled';
        if (settings[key] !== undefined) toggle.checked = settings[key];
      }
    });
    
    // Load site exceptions
    const exceptionsKey = `exceptions_${currentHostname}`;
    const data = await chrome.storage.local.get([exceptionsKey]);
    siteExceptions = data[exceptionsKey] || [];
    updateExceptionsList();
    
  } catch (error) {
    console.error('Site data error:', error);
    showToast('Failed to load site data', 'error');
  }
}

/**
 * Load blocked items for current site
 */
async function loadBlockedItems() {
  try {
    // Get blocked items from background using tab ID for accuracy
    const response = await safeSendMessage({ 
      action: 'getTabBlocked',
      tabId: currentTab?.id,
      hostname: currentHostname
    });
    
    if (response?.blockedItems) {
      siteBlocked = response.blockedItems;
      siteAllowed = response.allowedItems || [];
      siteExceptions = response.exceptions || [];
      currentTabStats = response.tabStats || null;
    } else {
      // Fallback: get from statistics and filter
      const statsResponse = await safeSendMessage({ action: 'getStatistics' });
      const blockLog = statsResponse?.blockLog || [];
      
      // Filter for current tab or hostname
      siteBlocked = blockLog.filter(item => {
        if (currentTab?.id && item.tabId === currentTab.id) {
          return true;
        }
        try {
          const url = new URL(item.url);
          return url.hostname.includes(currentHostname) || 
                 item.url.includes(currentHostname);
        } catch {
          return false;
        }
      });
    }
    
    // Update page stats
    updatePageStats();
    
    // Update blocked list
    updateBlockedList();
    
    // Update count in tab (fallback to length if stats missing)
    document.getElementById('blockedCount').textContent = currentTabStats ? currentTabStats.total : siteBlocked.length;
    
  } catch (error) {
    console.error('Blocked items error:', error);
    showToast('Failed to load blocked items', 'error');
  }
}

/**
 * Update power button state
 */
function updatePowerButton() {
  const powerBtn = document.getElementById('powerBtn');
  const siteStatusText = document.getElementById('siteStatusText');
  const statusDot = document.getElementById('siteStatusDot');
  
  if (powerBtn) {
    if (isEnabled) {
      powerBtn.classList.add('active');
      if (siteStatusText) siteStatusText.textContent = 'Protection Active';
      if (statusDot) statusDot.className = 'status-dot active';
    } else {
      powerBtn.classList.remove('active');
      if (siteStatusText) siteStatusText.textContent = 'Protection Disabled';
      if (statusDot) statusDot.className = 'status-dot';
    }
  }
}

/**
 * Update site status display
 */
function updateSiteStatus(isWhitelisted) {
  const siteStatusText = document.getElementById('siteStatusText');
  const statusDot = document.getElementById('siteStatusDot');
  const toggleBtn = document.getElementById('siteToggleBtn');
  
  if (isWhitelisted) {
    if (siteStatusText) siteStatusText.textContent = 'Site Allowed';
    if (statusDot) statusDot.className = 'status-dot';
    if (toggleBtn) toggleBtn.classList.add('whitelisted');
  } else {
    // If not whitelisted, the global state dictates status.
    updatePowerButton();
    if (toggleBtn) toggleBtn.classList.remove('whitelisted');
  }
}

/**
 * Update global statistics
 */
function updateGlobalStats(stats) {
  document.getElementById('totalBlocked').textContent = formatNumber(stats.totalBlocked || 0);
  document.getElementById('totalAds').textContent = formatNumber(stats.adsBlocked || 0);
  document.getElementById('totalTrackers').textContent = formatNumber(stats.trackersBlocked || 0);
  document.getElementById('dataSaved').textContent = formatBytes(stats.dataSaved || 0);
}

/**
 * Update page-specific stats
 */
function updatePageStats() {
  let total = 0, ads = 0, trackers = 0, miners = 0, malware = 0, other = 0;
  
  if (currentTabStats) {
    total = currentTabStats.total || 0;
    ads = currentTabStats.ad || 0;
    trackers = currentTabStats.tracker || 0;
    miners = currentTabStats.miner || 0;
    malware = currentTabStats.malware || 0;
    other = currentTabStats.other || 0;
  } else {
    total = siteBlocked.length;
    ads = siteBlocked.filter(i => i.type === 'ad').length;
    trackers = siteBlocked.filter(i => i.type === 'tracker').length;
    miners = siteBlocked.filter(i => i.type === 'miner').length;
    malware = siteBlocked.filter(i => i.type === 'malware').length;
    other = total - ads - trackers - miners - malware;
  }
  
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('pageTotal', total);
  setEl('pageAds', ads);
  setEl('pageTrackers', trackers);
  setEl('pageMiners', miners);
  setEl('pageMalware', malware);
  setEl('pageOther', other);
}

/**
 * Update blocked items list
 */
function updateBlockedList(filter = 'all') {
  const container = document.getElementById('blockedList');
  
  let items = [...siteBlocked, ...siteAllowed].sort((a, b) => b.timestamp - a.timestamp);
  
  if (filter !== 'all') {
    items = items.filter(i => i.type === filter);
  }
  
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">No network activity recorded yet on this page</div>';
    return;
  }
  
  // Show last 50 items
  const recent = items.slice(0, 50);
  
  let html = '';
  recent.forEach((item, index) => {
    const domain = escapeHTML(extractDomain(item.url));
    const typeClass = escapeHTML(item.type || 'unknown');
    const typeLabel = escapeHTML((item.type || 'unknown').charAt(0).toUpperCase() + (item.type || 'unknown').slice(1));
    const severity = escapeHTML(item.severity || 'low');
    const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
    const safeUrl = escapeHTML(item.url);
    const shortUrl = escapeHTML(item.url.length > 60 ? item.url.substring(0, 60) + '...' : item.url);
    
    const isAllowed = item.type === 'allowed';
    
    html += `
      <div class="blocked-item" data-index="${index}">
        <div class="blocked-item-header">
          <span class="blocked-type ${typeClass}">${isAllowed ? 'Allowed' : typeLabel}</span>
          ${!isAllowed ? `<span class="severity-badge severity-${severity}">${severityLabel}</span>` : ''}
          <span class="blocked-domain">${domain}</span>
          ${isAllowed 
            ? `<button class="block-btn" data-domain="${encodeURIComponent(domain)}" title="Block this domain"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg></button>`
            : `<button class="unblock-btn" data-url="${encodeURIComponent(item.url)}" title="Allow this"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button>`
          }
        </div>
        <div class="blocked-url" title="${safeUrl}">${shortUrl}</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Add handlers
  container.querySelectorAll('.unblock-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = decodeURIComponent(btn.dataset.url);
      addException(url);
    });
  });
  
  container.querySelectorAll('.block-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const domain = decodeURIComponent(btn.dataset.domain);
      blockConnection(domain);
    });
  });
}

/**
 * Update exceptions list
 */
function updateExceptionsList() {
  const container = document.getElementById('unblockedList');
  
  if (siteExceptions.length === 0) {
    container.innerHTML = '<div class="empty-state">No custom exceptions</div>';
    return;
  }
  
  let html = '';
  siteExceptions.forEach((exception, index) => {
    const safeException = escapeHTML(exception);
    const shortUrl = escapeHTML(exception.length > 50 ? exception.substring(0, 50) + '...' : exception);
    html += `
      <div class="exception-item">
        <span class="exception-url" title="${safeException}">${shortUrl}</span>
        <button class="remove-exception-btn" data-index="${index}" title="Remove"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Add remove handlers
  container.querySelectorAll('.remove-exception-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      removeException(parseInt(btn.dataset.index));
    });
  });
}

/**
 * Add exception for a URL
 */
async function addException(url) {
  try {
    // Send to background to create dynamic allow rule
    const response = await safeSendMessage({
      action: 'addException',
      hostname: currentHostname,
      url: url
    });
    
    if (response?.success) {
      siteExceptions = response.exceptions || [];
      updateExceptionsList();
      
      // Also update local storage backup
      const key = `exceptions_${currentHostname}`;
      await chrome.storage.local.set({ [key]: siteExceptions });
      
      showToast('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Exception added! Reload page to apply.');
    }
  } catch (error) {
    console.error('Add exception error:', error);
    showToast('Failed to add exception');
  }
}

/**
 * Remove exception
 */
async function removeException(index) {
  try {
    const url = siteExceptions[index];
    
    // Send to background to remove dynamic allow rule
    const response = await safeSendMessage({
      action: 'removeException',
      hostname: currentHostname,
      url: url
    });
    
    if (response?.success) {
      siteExceptions = response.exceptions || [];
      updateExceptionsList();
      
      // Also update local storage backup
      const key = `exceptions_${currentHostname}`;
      await chrome.storage.local.set({ [key]: siteExceptions });
      
      showToast('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Exception removed! Reload page to apply.');
    }
  } catch (error) {
    console.error('Remove exception error:', error);
    showToast('Failed to remove exception');
  }
}

/**
 * Block an allowed connection
 */
async function blockConnection(domain) {
  try {
    const response = await safeSendMessage({
      action: 'blockConnection',
      domain: domain
    });
    
    if (response?.success) {
      showToast(`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg> ${domain} blocked! Reload page to apply.`, 'warning');
      
      // Update local array for immediate UI feedback
      siteAllowed = siteAllowed.filter(i => extractDomain(i.url) !== domain);
      siteBlocked.unshift({ url: `https://${domain}`, type: 'tracker', severity: 'high', timestamp: Date.now() });
      updateBlockedList();
    }
  } catch (error) {
    console.error('Block connection error:', error);
    showToast('Failed to block domain');
  }
}

/**
 * Extract pattern from URL
 */
function extractPattern(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname.split('?')[0];
  } catch {
    return url;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Power button
  document.getElementById('powerBtn').addEventListener('click', async () => {
    const response = await safeSendMessage({ action: 'toggleProtection' });
    if (response) {
      isEnabled = response.isEnabled;
      updatePowerButton();
      
      // Show toast
      showToast(isEnabled ? 'Protection enabled' : 'Protection disabled');
      
      // Reload current tab to apply changes
      if (currentTab?.id) {
        chrome.tabs.reload(currentTab.id);
      }
    }
  });
  
  // Site toggle (whitelist)
  document.getElementById('siteToggleBtn').addEventListener('click', async () => {
    const response = await safeSendMessage({ action: 'getSettings' });
    const settings = response?.settings || {};
    const whitelist = settings.whitelist || [];
    const isWhitelisted = whitelist.includes(currentHostname);
    
    if (isWhitelisted) {
      await safeSendMessage({ 
        action: 'removeFromWhitelist', 
        domain: currentHostname 
      });
    } else {
      await safeSendMessage({ 
        action: 'addToWhitelist', 
        domain: currentHostname 
      });
    }
    
    updateSiteStatus(!isWhitelisted);
    showToast(isWhitelisted ? 'Site protection enabled' : 'Site whitelisted');
    
    // Reload tab
    if (currentTab?.id) {
      chrome.tabs.reload(currentTab.id);
    }
  });
  
  // Blocked filter
  document.getElementById('blockedFilter').addEventListener('change', (e) => {
    updateBlockedList(e.target.value);
  });
  
  // Refresh blocked
  document.getElementById('refreshBlockedBtn').addEventListener('click', loadBlockedItems);
  
  // Add exception manually
  document.getElementById('addExceptionBtn').addEventListener('click', () => {
    const input = document.getElementById('exceptionInput');
    const value = input.value.trim();
    if (value) {
      addException(value);
      input.value = '';
    }
  });
  
  document.getElementById('exceptionInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('addExceptionBtn').click();
    }
  });
  
  // Settings toggles
  ['Ads', 'Trackers', 'Miners', 'Fingerprint', 'Annoyances', 'OTA'].forEach(setting => {
    const toggle = document.getElementById(`toggle${setting}`);
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        let key = `block${setting}`;
        if (setting === 'Fingerprint') key = 'antiFingerprint';
        if (setting === 'Annoyances') key = 'blockAnnoyances';
        if (setting === 'OTA') key = 'otaEnabled';
        
        await safeSendMessage({
          action: 'updateSettings',
          settings: { [key]: e.target.checked }
        });
      });
    }
  });
  
  // Zapper Actions
  const zapBtn = document.getElementById('zapElementBtn');
  if (zapBtn) {
    zapBtn.addEventListener('click', () => {
      if (currentTab?.id) {
        chrome.tabs.sendMessage(currentTab.id, { type: 'ACTIVATE_ZAPPER' }).catch(err => {
          console.warn('Could not activate zapper on this page', err);
        });
        window.close();
      }
    });
  }

  const clearZapperBtn = document.getElementById('clearZapperBtn');
  if (clearZapperBtn) {
    clearZapperBtn.addEventListener('click', () => {
      if (currentTab?.id) {
        chrome.tabs.sendMessage(currentTab.id, { type: 'CLEAR_ZAPPER' }).catch(err => {
          console.warn('Could not clear zapper on this page', err);
        });
        showToast('Zapper rules cleared for this site');
      }
    });
  }

  // Action buttons
  document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
  
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  document.getElementById('resetStats').addEventListener('click', async () => {
    if (confirm('Reset all statistics?')) {
      await safeSendMessage({ action: 'resetStatistics' });
      await loadStatus();
      await loadBlockedItems();
      showToast('Statistics reset');
    }
  });
}

/**
 * Setup tabs
 */
function setupTabs() {
  const tabBtns = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Update buttons
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update content
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        }
      });
    });
  });
}

/**
 * Show toast message
 */
function showToast(message, type = 'success') {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  if (type === 'error') toast.style.background = '#ef4444';
  if (type === 'warning') toast.style.background = '#f59e0b';
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Utility functions
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    const match = url.match(/(?:https?:\/\/)?([^\/]+)/);
    return match ? match[1] : url.substring(0, 30);
  }
}

// Auto-refresh every 5 seconds
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadBlockedItems();
  }
}, 5000);

