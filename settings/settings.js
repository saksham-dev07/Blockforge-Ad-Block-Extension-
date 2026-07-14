
/**
 * BlockForge - Settings Page Script
 * 
 * Handles settings page logic:
 * - Loading and saving settings
 * - Navigation between sections
 * - Filter list management
 * - Whitelist/Blacklist management
 * - Import/Export functionality
 */

// ============================================================================
// STATE
// ============================================================================

let settings = {};
let filterLists = [];
let whitelist = [];
let blacklist = [];
let customRules = [];

// ============================================================================
// INITIALIZATION
// ============================================================================

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
  await loadAllData();
  setupNavigation();
  setupEventListeners();
  updateUI();
});

/**
 * Load all data from background
 */
async function loadAllData() {
  try {
    // Get settings
    const settingsResponse = await safeSendMessage({ type: 'GET_SETTINGS' });
    settings = settingsResponse?.settings || settingsResponse || {};
    
    // Get filter lists
    const filtersResponse = await safeSendMessage({ type: 'GET_FILTER_LISTS' });
    filterLists = Array.isArray(filtersResponse) ? filtersResponse : 
                  Array.isArray(filtersResponse?.filterLists) ? filtersResponse.filterLists : 
                  getDefaultFilterLists();
    
    // Get custom rules
    const rulesResponse = await safeSendMessage({ type: 'GET_CUSTOM_RULES' });
    customRules = Array.isArray(rulesResponse) ? rulesResponse : 
                  Array.isArray(rulesResponse?.rules) ? rulesResponse.rules : [];
    
    // Get global stats for about section
    const statsResponse = await safeSendMessage({ type: 'GET_GLOBAL_STATS' });
    if (statsResponse) {
      updateAboutStats(statsResponse);
    }
    
    // Extract whitelist and blacklist from settings
    whitelist = settings.whitelist || [];
    blacklist = settings.blacklist || [];
    
  } catch (error) {
    console.error('Failed to load data:', error);
    // Use defaults on error
    filterLists = getDefaultFilterLists();
  }
}

/**
 * Get default filter lists when none are available
 */
function getDefaultFilterLists() {
  return [
    { id: 'ads', name: 'Ad Blocking', enabled: true, rulesCount: 200 },
    { id: 'trackers', name: 'Tracker Blocking', enabled: true, rulesCount: 80 },
    { id: 'miners', name: 'Crypto Miner Blocking', enabled: true, rulesCount: 50 },
    { id: 'malware', name: 'Malware Protection', enabled: true, rulesCount: 100 },
    { id: 'social', name: 'Social Widget Blocking', enabled: false, rulesCount: 30 }
  ];
}

/**
 * Update UI with loaded data
 */
function updateUI() {
  // General settings
  setToggle('settingEnabled', settings.enabled !== false);
  setToggle('settingBadge', settings.showBadge !== false);
  setToggle('settingNotifications', settings.notifications === true);
  setSelect('settingTheme', settings.theme || 'auto');
  
  // Blocking settings
  setBlockingLevel(settings.blockingLevel || 'moderate');
  setToggle('settingBlockAds', settings.blockAds !== false);
  setToggle('settingBlockTrackers', settings.blockTrackers !== false);
  setToggle('settingBlockSocial', settings.blockSocial !== false);
  setToggle('settingBlockMiners', settings.blockMiners !== false);
  setToggle('settingBlockMalware', settings.blockMalware !== false);
  
  // Privacy settings
  setToggle('settingAntiFingerprint', settings.antiFingerprint !== false);
  setToggle('settingCanvasProtect', settings.canvasProtect !== false);
  setToggle('settingWebGLProtect', settings.webglProtect !== false);
  setToggle('settingAudioProtect', settings.audioProtect !== false);
  setToggle('settingCookieAutoDelete', settings.cookieAutoDelete === true);
  setToggle('settingRemoveTracking', settings.removeTrackingParams !== false);
  setToggle('settingBlockWebRTC', settings.blockWebRTC === true);
  setToggle('settingBlockBattery', settings.blockBatteryAPI !== false);
  setToggle('settingAIDetection', settings.aiDetection !== false);
  setToggle('settingAILearning', settings.aiLearning !== false);
  
  // Advanced settings
  setToggle('settingLazyLoad', settings.lazyLoad !== false);
  setToggle('settingCacheFilters', settings.cacheFilters !== false);
  setSelect('settingStatsRetention', String(settings.statsRetention || 30));
  
  // OTA settings
  setToggle('settingOTAEnabled', settings.otaEnabled === true);
  loadOTAStatus();
  
  // Render lists
  renderFilterLists();
  renderWhitelist();
  renderBlacklist();
  renderCustomRules();
}

/**
 * Update about section stats
 */
function updateAboutStats(stats) {
  document.getElementById('aboutTotalBlocked').textContent = formatNumber(stats.totalBlocked || 0);
  document.getElementById('aboutDataSaved').textContent = formatBytes(stats.dataSaved || 0);
  
  if (stats.firstRun) {
    const days = Math.floor((Date.now() - stats.firstRun) / 86400000);
    document.getElementById('aboutProtectionDays').textContent = days;
  }
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Setup sidebar navigation
 */
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const section = item.dataset.section;
      
      // Update active nav item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Show corresponding section
      document.querySelectorAll('.settings-section').forEach(sec => {
        sec.classList.remove('active');
      });
      document.getElementById(section).classList.add('active');
    });
  });
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Toggle listeners
  setupToggleListeners();
  
  // Select listeners
  setupSelectListeners();
  
  // Blocking level cards
  document.querySelectorAll('.level-card').forEach(card => {
    card.addEventListener('click', () => {
      selectBlockingLevel(card.dataset.level);
    });
  });
  
  // Filter list actions
  document.getElementById('updateFiltersBtn').addEventListener('click', updateFilterLists);
  document.getElementById('addCustomListBtn')?.addEventListener('click', addCustomList);
  
  // Whitelist actions
  document.getElementById('addWhitelistBtn').addEventListener('click', addToWhitelist);
  document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addToWhitelist();
  });
  
  // Blacklist actions
  document.getElementById('addBlacklistBtn').addEventListener('click', addToBlacklist);
  document.getElementById('blacklistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addToBlacklist();
  });
  
  // Custom rules
  document.getElementById('addCustomRuleBtn').addEventListener('click', addCustomRules);
  
  // Import/Export
  document.getElementById('exportBtn').addEventListener('click', exportSettings);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importSettings);
  
  // Danger zone
  document.getElementById('resetStatsBtn').addEventListener('click', resetStatistics);
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
  document.getElementById('resetSettingsBtn').addEventListener('click', resetToDefaults);
  
  // About links
  document.getElementById('dashboardLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
  
  // OTA actions
  document.getElementById('forceOTAUpdateBtn')?.addEventListener('click', forceOTASync);
  document.getElementById('clearOTARulesBtn')?.addEventListener('click', clearOTARules);
  
  // OTA toggle watcher — refresh status card when toggled
  document.getElementById('settingOTAEnabled')?.addEventListener('change', (e) => {
    setTimeout(loadOTAStatus, 500);
  });
}

/**
 * Setup toggle switch listeners
 */
function setupToggleListeners() {
  const toggleMappings = {
    'settingEnabled': 'enabled',
    'settingBadge': 'showBadge',
    'settingNotifications': 'notifications',
    'settingBlockAds': 'blockAds',
    'settingBlockTrackers': 'blockTrackers',
    'settingBlockSocial': 'blockSocial',
    'settingBlockMiners': 'blockMiners',
    'settingBlockMalware': 'blockMalware',
    'settingAntiFingerprint': 'antiFingerprint',
    'settingCanvasProtect': 'canvasProtect',
    'settingWebGLProtect': 'webglProtect',
    'settingAudioProtect': 'audioProtect',
    'settingCookieAutoDelete': 'cookieAutoDelete',
    'settingRemoveTracking': 'removeTrackingParams',
    'settingBlockWebRTC': 'blockWebRTC',
    'settingBlockBattery': 'blockBatteryAPI',
    'settingAIDetection': 'aiDetection',
    'settingAILearning': 'aiLearning',
    'settingLazyLoad': 'lazyLoad',
    'settingCacheFilters': 'cacheFilters',
    'settingOTAEnabled': 'otaEnabled'
  };
  
  for (const [elementId, settingKey] of Object.entries(toggleMappings)) {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', (e) => {
        updateSetting(settingKey, e.target.checked);
      });
    }
  }
}

/**
 * Setup select listeners
 */
function setupSelectListeners() {
  document.getElementById('settingTheme')?.addEventListener('change', (e) => {
    updateSetting('theme', e.target.value);
  });
  
  document.getElementById('settingStatsRetention')?.addEventListener('change', (e) => {
    updateSetting('statsRetention', parseInt(e.target.value));
  });
}

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

/**
 * Update a single setting
 */
async function updateSetting(key, value) {
  settings[key] = value;
  
  try {
    await safeSendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { [key]: value }
    });
    
    showToast('Setting saved');
  } catch (error) {
    console.error('Failed to save setting:', error);
    showToast('Failed to save setting', 'error');
  }
}

/**
 * Select blocking level
 */
async function selectBlockingLevel(level) {
  // Update UI
  document.querySelectorAll('.level-card').forEach(card => {
    card.classList.remove('selected');
  });
  document.querySelector(`.level-card[data-level="${level}"]`).classList.add('selected');
  
  // Save setting
  await updateSetting('blockingLevel', level);
  
  // Update related toggles based on level
  const levelSettings = {
    minimal: {
      blockAds: false,
      blockTrackers: false,
      blockSocial: false,
      blockMiners: true,
      blockMalware: true
    },
    moderate: {
      blockAds: true,
      blockTrackers: true,
      blockSocial: true,
      blockMiners: true,
      blockMalware: true
    },
    aggressive: {
      blockAds: true,
      blockTrackers: true,
      blockSocial: true,
      blockMiners: true,
      blockMalware: true
    }
  };
  
  const levelConfig = levelSettings[level];
  for (const [key, value] of Object.entries(levelConfig)) {
    settings[key] = value;
    setToggle(`setting${key.charAt(0).toUpperCase() + key.slice(1)}`, value);
  }
  
  await safeSendMessage({
    type: 'UPDATE_SETTINGS',
    settings: levelConfig
  });
}

// ============================================================================
// FILTER LISTS
// ============================================================================

/**
 * Render filter lists
 */
function renderFilterLists() {
  const container = document.getElementById('filterListContainer');
  if (!container) return;
  
  // Ensure filterLists is an array
  if (!Array.isArray(filterLists)) {
    filterLists = getDefaultFilterLists();
  }
  
  container.innerHTML = filterLists.map(list => `
    <div class="filter-item" data-id="${list.id}">
      <div class="filter-info">
        <div class="filter-name">${list.name}</div>
        <div class="filter-meta">
          ${list.rulesCount || 0} rules • 
          ${list.lastUpdated ? 'Updated ' + formatDate(list.lastUpdated) : 'Never updated'}
        </div>
      </div>
      <label class="toggle-switch filter-toggle" for="filter-${list.id}">
        <input type="checkbox" id="filter-${list.id}" data-filter-id="${list.id}" ${list.enabled ? 'checked' : ''} title="Toggle filter list">
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');
  
  // Add event listeners for filter toggles
  container.querySelectorAll('input[data-filter-id]').forEach(input => {
    input.addEventListener('change', function() {
      toggleFilterList(this.dataset.filterId, this.checked);
    });
  });
}

/**
 * Toggle a filter list
 */
async function toggleFilterList(id, enabled) {
  try {
    await safeSendMessage({
      type: 'TOGGLE_FILTER_LIST',
      id,
      enabled
    });
    
    // Update local state
    const list = filterLists.find(l => l.id === id);
    if (list) list.enabled = enabled;
    
    showToast(enabled ? 'Filter list enabled' : 'Filter list disabled');
  } catch (error) {
    console.error('Failed to toggle filter list:', error);
    showToast('Failed to update filter list', 'error');
  }
}

/**
 * Update all filter lists
 */
async function updateFilterLists() {
  const btn = document.getElementById('updateFiltersBtn');
  btn.disabled = true;
  btn.innerHTML = '<span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path></svg></span> Updating...';
  
  try {
    await safeSendMessage({ type: 'UPDATE_FILTER_LISTS' });
    
    // Reload filter lists
    const response = await safeSendMessage({ type: 'GET_FILTER_LISTS' });
    filterLists = response || [];
    renderFilterLists();
    
    document.getElementById('lastUpdated').textContent = `Last updated: ${formatDate(Date.now())}`;
    showToast('Filter lists updated');
  } catch (error) {
    console.error('Failed to update filter lists:', error);
    showToast('Failed to update filter lists', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></span> Update All Lists';
  }
}

/**
 * Add custom filter list
 */
async function addCustomList() {
  const input = document.getElementById('customListUrl');
  const url = input.value.trim();
  
  if (!url) return;
  
  try {
    await safeSendMessage({
      type: 'ADD_CUSTOM_FILTER_LIST',
      url
    });
    
    input.value = '';
    
    // Reload filter lists
    const response = await safeSendMessage({ type: 'GET_FILTER_LISTS' });
    filterLists = response || [];
    renderFilterLists();
    
    showToast('Custom filter list added');
  } catch (error) {
    console.error('Failed to add custom list:', error);
    showToast('Failed to add filter list', 'error');
  }
}

// ============================================================================
// WHITELIST / BLACKLIST
// ============================================================================

/**
 * Render whitelist
 */
function renderWhitelist() {
  const container = document.getElementById('whitelistContainer');
  if (!container) return;
  
  if (whitelist.length === 0) {
    container.innerHTML = '<div class="empty-list">No whitelisted sites</div>';
    return;
  }
  
  container.innerHTML = whitelist.map(domain => {
    const safeDomain = escapeHTML(domain);
    return `
    <div class="list-item">
      <span class="domain-name" title="${safeDomain}">${safeDomain}</span>
      <button class="icon-btn remove-btn" onclick="removeFromWhitelist('${safeDomain}')" title="Remove">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `}).join('');
}

/**
 * Add site to whitelist
 */
async function addToWhitelist() {
  const input = document.getElementById('whitelistInput');
  const domain = input.value.trim().toLowerCase();
  
  if (!domain) return;
  if (whitelist.includes(domain)) {
    showToast('Site already whitelisted', 'warning');
    return;
  }
  
  whitelist.push(domain);
  
  try {
    await safeSendMessage({
      type: 'WHITELIST_SITE',
      hostname: domain,
      add: true
    });
    
    input.value = '';
    renderWhitelist();
    showToast('Site whitelisted');
  } catch (error) {
    whitelist.pop();
    console.error('Failed to whitelist site:', error);
    showToast('Failed to whitelist site', 'error');
  }
}

/**
 * Remove site from whitelist
 */
window.removeFromWhitelist = async function(domain) {
  try {
    await safeSendMessage({
      type: 'WHITELIST_SITE',
      hostname: domain,
      add: false
    });
    
    whitelist = whitelist.filter(d => d !== domain);
    renderWhitelist();
    showToast('Site removed from whitelist');
  } catch (error) {
    console.error('Failed to remove from whitelist:', error);
    showToast('Failed to remove site', 'error');
  }
};

/**
 * Render blacklist
 */
function renderBlacklist() {
  const container = document.getElementById('blacklistContainer');
  if (!container) return;
  
  if (blacklist.length === 0) {
    container.innerHTML = '<div class="empty-list">No blacklisted sites</div>';
    return;
  }
  
  container.innerHTML = blacklist.map(domain => {
    const safeDomain = escapeHTML(domain);
    return `
    <div class="list-item">
      <span class="domain-name" title="${safeDomain}">${safeDomain}</span>
      <button class="icon-btn remove-btn" onclick="removeFromBlacklist('${safeDomain}')" title="Remove">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `}).join('');
}

/**
 * Add site to blacklist
 */
async function addToBlacklist() {
  const input = document.getElementById('blacklistInput');
  const domain = input.value.trim().toLowerCase();
  
  if (!domain) return;
  if (blacklist.includes(domain)) {
    showToast('Site already blacklisted', 'warning');
    return;
  }
  
  blacklist.push(domain);
  
  try {
    await safeSendMessage({
      type: 'BLACKLIST_SITE',
      hostname: domain,
      add: true
    });
    
    input.value = '';
    renderBlacklist();
    showToast('Site blacklisted');
  } catch (error) {
    blacklist.pop();
    console.error('Failed to blacklist site:', error);
    showToast('Failed to blacklist site', 'error');
  }
}

/**
 * Remove site from blacklist
 */
window.removeFromBlacklist = async function(domain) {
  try {
    await safeSendMessage({
      type: 'BLACKLIST_SITE',
      hostname: domain,
      add: false
    });
    
    blacklist = blacklist.filter(d => d !== domain);
    renderBlacklist();
    showToast('Site removed from blacklist');
  } catch (error) {
    console.error('Failed to remove from blacklist:', error);
    showToast('Failed to remove site', 'error');
  }
};

// ============================================================================
// CUSTOM RULES
// ============================================================================

/**
 * Render custom rules
 */
function renderCustomRules() {
  const container = document.getElementById('customRulesContainer');
  if (!container) return;
  
  if (customRules.length === 0) {
    container.innerHTML = '<div class="empty-list">No custom rules</div>';
    return;
  }
  
  container.innerHTML = customRules.map(rule => `
    <div class="rule-item" data-id="${rule.id}">
      <span class="rule-text">${rule.pattern || rule.originalRule || rule}</span>
      <button class="domain-remove" onclick="removeCustomRule(${rule.id})"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
    </div>
  `).join('');
}

/**
 * Add custom rules
 */
async function addCustomRules() {
  const input = document.getElementById('customRuleInput');
  const rulesText = input.value.trim();
  
  if (!rulesText) return;
  
  const rules = rulesText.split('\n').filter(r => r.trim());
  
  try {
    for (const rule of rules) {
      await safeSendMessage({
        type: 'ADD_CUSTOM_RULE',
        rule: { pattern: rule.trim(), type: 'block' }
      });
    }
    
    input.value = '';
    
    // Reload rules
    const response = await safeSendMessage({ type: 'GET_CUSTOM_RULES' });
    customRules = response || [];
    renderCustomRules();
    
    showToast(`Added ${rules.length} rule(s)`);
  } catch (error) {
    console.error('Failed to add custom rules:', error);
    showToast('Failed to add rules', 'error');
  }
}

/**
 * Remove custom rule
 */
window.removeCustomRule = async function(ruleId) {
  try {
    await safeSendMessage({
      type: 'REMOVE_CUSTOM_RULE',
      ruleId
    });
    
    customRules = customRules.filter(r => r.id !== ruleId);
    renderCustomRules();
    showToast('Rule removed');
  } catch (error) {
    console.error('Failed to remove rule:', error);
    showToast('Failed to remove rule', 'error');
  }
};

// ============================================================================
// IMPORT / EXPORT
// ============================================================================

/**
 * Export settings to JSON file
 */
async function exportSettings() {
  try {
    const response = await safeSendMessage({ type: 'EXPORT_SETTINGS' });
    
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `blockforge-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Settings exported');
  } catch (error) {
    console.error('Failed to export settings:', error);
    showToast('Failed to export settings', 'error');
  }
}

/**
 * Import settings from JSON file
 */
async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    await safeSendMessage({
      type: 'IMPORT_SETTINGS',
      data
    });
    
    // Reload all data
    await loadAllData();
    updateUI();
    
    showToast('Settings imported');
  } catch (error) {
    console.error('Failed to import settings:', error);
    showToast('Failed to import settings', 'error');
  }
  
  // Reset file input
  event.target.value = '';
}

// ============================================================================
// DANGER ZONE
// ============================================================================

/**
 * Reset statistics
 */
async function resetStatistics() {
  if (!confirm('Are you sure you want to reset all statistics? This cannot be undone.')) {
    return;
  }
  
  try {
    await safeSendMessage({ type: 'RESET_STATISTICS' });
    showToast('Statistics reset');
    
    // Update about section
    document.getElementById('aboutTotalBlocked').textContent = '0';
    document.getElementById('aboutDataSaved').textContent = '0 B';
  } catch (error) {
    console.error('Failed to reset statistics:', error);
    showToast('Failed to reset statistics', 'error');
  }
}

/**
 * Clear all data
 */
async function clearAllData() {
  if (!confirm('Are you sure you want to clear ALL data? This will reset everything including settings, filter lists, and statistics. This cannot be undone.')) {
    return;
  }
  
  try {
    await safeSendMessage({ type: 'CLEAR_ALL_DATA' });
    showToast('All data cleared');
    
    // Reload page
    setTimeout(() => window.location.reload(), 1000);
  } catch (error) {
    console.error('Failed to clear data:', error);
    showToast('Failed to clear data', 'error');
  }
}

/**
 * Reset to default settings
 */
async function resetToDefaults() {
  if (!confirm('Are you sure you want to reset all settings to defaults?')) {
    return;
  }
  
  try {
    await safeSendMessage({ type: 'RESET_TO_DEFAULTS' });
    showToast('Settings reset to defaults');
    
    // Reload all data
    await loadAllData();
    updateUI();
  } catch (error) {
    console.error('Failed to reset settings:', error);
    showToast('Failed to reset settings', 'error');
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Set toggle state
 */
function setToggle(id, checked) {
  const element = document.getElementById(id);
  if (element) element.checked = checked;
}

/**
 * Set select value
 */
function setSelect(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value;
}

/**
 * Set blocking level UI
 */
function setBlockingLevel(level) {
  document.querySelectorAll('.level-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.level === level);
  });
}

/**
 * Format number
 */
function formatNumber(num) {
  if (num < 1000) return String(num);
  if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
  return (num / 1000000).toFixed(1) + 'M';
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

/**
 * Format date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
  
  return date.toLocaleDateString();
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#2563eb'};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add toast animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// ============================================================================
// OTA UPDATES
// ============================================================================

/**
 * Load and display the current OTA status
 */
async function loadOTAStatus() {
  const statusEl = document.getElementById('otaStatus');
  const lastSyncEl = document.getElementById('otaLastSync');
  const ruleCountEl = document.getElementById('otaRuleCount');
  
  if (!statusEl) return;
  
  try {
    // Get OTA metadata from storage
    const data = await chrome.storage.local.get(['lastOTAUpdate', 'otaRuleCount', 'settings']);
    const currentSettings = data.settings || settings;
    const lastUpdate = data.lastOTAUpdate || 0;
    const ruleCount = data.otaRuleCount || 0;
    
    if (!currentSettings.otaEnabled) {
      statusEl.textContent = 'Disabled';
      statusEl.className = 'ota-status-value';
      lastSyncEl.textContent = 'Never';
      ruleCountEl.textContent = '0';
      return;
    }
    
    if (lastUpdate > 0) {
      statusEl.textContent = 'Active';
      statusEl.className = 'ota-status-value ota-synced';
      lastSyncEl.textContent = new Date(lastUpdate).toLocaleString();
    } else {
      statusEl.textContent = 'Waiting for first sync';
      statusEl.className = 'ota-status-value ota-syncing';
      lastSyncEl.textContent = 'Never';
    }
    
    // Count active OTA dynamic rules (IDs 600000+)
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const otaCount = dynamicRules.filter(r => r.id >= 600000 && r.id < 630000).length;
    ruleCountEl.textContent = otaCount.toLocaleString();
    
    // Persist for quick access
    if (otaCount !== ruleCount) {
      await chrome.storage.local.set({ otaRuleCount: otaCount });
    }
  } catch (error) {
    console.error('Failed to load OTA status:', error);
    statusEl.textContent = 'Error';
    statusEl.className = 'ota-status-value ota-error';
  }
}

/**
 * Force an immediate OTA sync
 */
async function forceOTASync() {
  const statusEl = document.getElementById('otaStatus');
  const btn = document.getElementById('forceOTAUpdateBtn');
  
  // Temporarily enable OTA if it's off
  if (!settings.otaEnabled) {
    settings.otaEnabled = true;
    setToggle('settingOTAEnabled', true);
    await safeSendMessage({ type: 'UPDATE_SETTINGS', settings: { otaEnabled: true } });
  }
  
  // Show syncing state
  statusEl.textContent = 'Syncing...';
  statusEl.className = 'ota-status-value ota-syncing';
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  
  try {
    const response = await safeSendMessage({ type: 'FORCE_OTA_UPDATE' });
    
    if (response?.success) {
      showToast('OTA rules updated successfully!');
    } else {
      showToast('OTA sync failed: ' + (response?.error || 'Unknown error'));
    }
  } catch (error) {
    showToast('OTA sync failed: ' + error.message);
  }
  
  // Restore button
  btn.disabled = false;
  btn.innerHTML = '<span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></span> Sync Now';
  
  // Refresh status card
  setTimeout(loadOTAStatus, 500);
}

/**
 * Clear all OTA dynamic rules
 */
async function clearOTARules() {
  if (!confirm('This will remove all OTA-downloaded rules. Are you sure?')) return;
  
  try {
    // Remove all dynamic rules in the OTA range
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const otaRuleIds = dynamicRules
      .filter(r => r.id >= 600000 && r.id < 630000)
      .map(r => r.id);
    
    if (otaRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: otaRuleIds
      });
    }
    
    await chrome.storage.local.set({ lastOTAUpdate: 0, otaRuleCount: 0 });
    
    showToast(`Cleared ${otaRuleIds.length} OTA rules`);
    loadOTAStatus();
  } catch (error) {
    console.error('Failed to clear OTA rules:', error);
    showToast('Failed to clear OTA rules');
  }
}

