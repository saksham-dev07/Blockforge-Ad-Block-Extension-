// Main Service Worker for BlockForge
// Self-contained - no external imports for reliability

// Extension state
let isEnabled = true;
let settings = {};

// Tab-specific block counts
const tabBlockCounts = new Map();

// Default settings
function getDefaultSettings() {
  return {
    blockAds: true,
    blockTrackers: true,
    blockMiners: true,
    blockMalware: true,
    aiDetection: true,
    antiFingerprint: true,
    httpsUpgrade: true,
    blockThirdPartyCookies: true,
    blockAnnoyances: true,
    otaEnabled: false,
    customFilters: [],
    whitelist: []
  };
}

// Default statistics object
function getDefaultStats() {
  return {
    totalBlocked: 0,
    adsBlocked: 0,
    trackersBlocked: 0,
    minersBlocked: 0,
    malwareBlocked: 0,
    dataSaved: 0,
    timeSaved: 0
  };
}

// Initialize extension
async function initialize() {
  console.log('[BlockForge] BlockForge initializing...');
  
  try {
    // Load settings
    const data = await chrome.storage.local.get(['isEnabled', 'settings']);
    isEnabled = data.isEnabled !== false;
    settings = data.settings || getDefaultSettings();
    
    // Update declarative rules based on settings
    await updateRules();
    
    // Check for OTA updates on startup
    checkForOTAUpdates();
    
    // Update badge
    await updateBadge();
    
    console.log('[BlockForge] BlockForge initialized successfully');
    console.log('[BlockForge] Protection enabled:', isEnabled);
  } catch (error) {
    console.error('[BlockForge] Initialization error:', error);
  }
}

// ============================================================================
// TAB LIFECYCLE INTERCEPTOR ($popup / $popunder support)
// ============================================================================

let popupRulesCache = [];

async function updatePopupRules() {
  const customData = await chrome.storage.local.get(['customRules']);
  const customRules = customData.customRules || [];
  popupRulesCache = customRules
    .filter(r => r.pattern && (r.pattern.includes('$popup') || r.pattern.includes('$popunder')))
    .map(r => {
      // Extract the domain or path from rules like ||example.com/AdHandler.aspx?$popunder
      const match = r.pattern.match(/\|\|(.*?)\$/);
      return match ? match[1] : null;
    })
    .filter(d => d);
}

// Initialize popup rules
updatePopupRules();

// Re-parse when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.customRules) {
    updatePopupRules();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && popupRulesCache.length > 0) {
    try {
      const urlStr = changeInfo.url;
      // Also close data: and about:blank tabs if they are spawned dynamically, 
      // but only if we have strict popup blocking rules enabled and the URL matches a blocked pattern
      
      const shouldClose = popupRulesCache.some(pattern => {
        // Simple string inclusion check for URL matching
        return urlStr.includes(pattern);
      });
      
      if (shouldClose) {
        chrome.tabs.remove(tabId).catch(() => {});
        console.log(`[BlockForge] Automatically closed popup tab ${tabId} matching $popup rule: ${urlStr}`);
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }
});



// Update declarative net request rules based on settings
async function updateRules() {
  const enabledRulesets = [];
  const disabledRulesets = [];
  
  if (isEnabled && settings.blockAds !== false) {
    enabledRulesets.push('ads_rules');
  } else {
    disabledRulesets.push('ads_rules');
  }
  
  if (isEnabled && settings.blockTrackers !== false) {
    enabledRulesets.push('trackers_rules');
  } else {
    disabledRulesets.push('trackers_rules');
  }
  
  if (isEnabled && settings.blockMiners !== false) {
    enabledRulesets.push('miners_rules');
  } else {
    disabledRulesets.push('miners_rules');
  }
  
  if (isEnabled && settings.blockMalware !== false) {
    enabledRulesets.push('malware_rules');
  } else {
    disabledRulesets.push('malware_rules');
  }
  
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabledRulesets,
      disableRulesetIds: disabledRulesets
    });
    
    // Sync dynamic allow rules for whitelisted sites
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    
    // Clear our managed dynamic rules (whitelist 200k+, blacklist 300k+, custom 400k-600k)
    const managedRuleIds = existingRules
      .filter(r => (r.id >= 190000 && r.id < 600000))
      .map(r => r.id);
    
    const newDynamicRules = [];
    
    if (isEnabled) {
      // 1. Whitelist (allowAllRequests)
      if (settings.whitelist) {
        settings.whitelist.forEach((domain, index) => {
          if (domain && domain.trim()) {
            newDynamicRules.push({
              id: 200000 + index,
              priority: 99999,
              action: { type: 'allowAllRequests' },
              condition: { 
                requestDomains: [domain.trim()],
                resourceTypes: ['main_frame', 'sub_frame']
              }
            });
          }
        });
      }
      
      // 2. Blacklist (block)
      if (settings.blacklist) {
        settings.blacklist.forEach((domain, index) => {
          if (domain && domain.trim()) {
            newDynamicRules.push({
              id: 300000 + index,
              priority: 50000,
              action: { type: 'block' },
              condition: { urlFilter: `||${domain.trim()}^` }
            });
          }
        });
      }
      
      // 3. Custom Rules
      const customData = await chrome.storage.local.get(['customRules']);
      const customRules = customData.customRules || [];
      customRules.forEach((rule, index) => {
        if (rule && rule.pattern) {
          const isAllow = rule.type === 'allow';
          newDynamicRules.push({
            id: (isAllow ? 500000 : 400000) + index,
            priority: 40000,
            action: { type: isAllow ? 'allow' : 'block' },
            condition: { urlFilter: rule.pattern }
          });
        }
      });
    }
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: managedRuleIds,
      addRules: newDynamicRules
    });
    
    // Toggle static rulesets based on extension enabled state
    const staticRulesets = ['ads_rules', 'trackers_rules', 'miners_rules', 'malware_rules'];
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: isEnabled ? staticRulesets : [],
      disableRulesetIds: isEnabled ? [] : staticRulesets
    });
    
    // Always unregister youtube-bypass to prevent 403 Forbidden issues
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ['youtube-bypass'] });
    } catch (e) {
      // Ignore
    }
    
    console.log(`[BlockForge] Rules updated. Synced ${newDynamicRules.length} dynamic rules. Static rulesets: ${isEnabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('[BlockForge] Failed to update rules:', error);
  }
}

// Track blocked requests using declarativeNetRequest feedback
// This is the MV3-compliant way to monitor blocked requests
try {
  if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      if (!isEnabled) return;
      
      const { request, rule } = info;
      const url = request.url;
      const tabId = request.tabId;
      
      // Ignore whitelist rules (200000-299999) and custom allow rules (500000+)
      if (!rule.rulesetId || rule.rulesetId === '_dynamic' || rule.rulesetId === '') {
        if ((rule.ruleId >= 200000 && rule.ruleId < 300000) || rule.ruleId >= 500000) {
          return; // This is an allow rule, do not count as a block
        }
      }
      
      // Debug logging disabled for performance — uncomment to troubleshoot
      // console.log('[BlockForge] Blocked:', url, 'Rule:', rule.ruleId, 'Ruleset:', rule.rulesetId);
      
      // Determine block type from ruleset
      let blockType = 'ad';
      if (rule.rulesetId === 'ads_rules') blockType = 'ad';
      else if (rule.rulesetId === 'trackers_rules') blockType = 'tracker';
      else if (rule.rulesetId === 'miners_rules') blockType = 'miner';
      else if (rule.rulesetId === 'malware_rules') blockType = 'malware';
      
      // Get the source page URL (the page where the block occurred)
      let sourceUrl = request.initiator || request.documentUrl || '';
      
      // If we have a valid tabId, try to get the tab URL for more accuracy
      if (tabId > 0) {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            queueBlock(tabId, url, blockType, sourceUrl);
          } else {
            queueBlock(tabId, url, blockType, tab.url || sourceUrl);
          }
        });
      } else {
        queueBlock(tabId, url, blockType, sourceUrl);
      }
    });
    console.log('[BlockForge] Rule match debug listener registered');
  } else {
    console.log('[BlockForge] onRuleMatchedDebug not available (normal in production)');
  }
} catch (e) {
  console.log('[BlockForge] Could not register debug listener:', e.message);
}

// Memory buffer for batched recording to prevent storage race conditions
let blockBuffer = [];
let blockBufferTimer = null;

const HIGH_SEVERITY_DOMAINS = [
  'hotjar', 'clarity', 'fullstory', 'logrocket', 'smartlook', // Session recorders
  'facebook.com/tr', 'google-analytics', 'mixpanel', 'segment', 'amplitude', // Heavy analytics
  'doubleclick.net', 'adnxs.com', 'criteo.com', 'taboola', 'outbrain' // Heavy ad/retargeting networks
];

function determineSeverity(url, type) {
  if (type === 'malware') return 'critical';
  if (type === 'miner') return 'high';
  
  const urlLower = url.toLowerCase();
  
  // Check against known high severity domains
  for (const domain of HIGH_SEVERITY_DOMAINS) {
    if (urlLower.includes(domain)) {
      return type === 'tracker' ? 'critical' : 'high';
    }
  }
  
  // Default fallbacks based on type
  if (type === 'tracker') return 'medium';
  if (type === 'ad') return 'low';
  
  return 'low';
}

function queueBlock(tabId, url, type, source) {
  const severity = determineSeverity(url, type);
  blockBuffer.push({ tabId, url, type, source, severity, timestamp: Date.now() });
  
  if (!blockBufferTimer) {
    blockBufferTimer = setTimeout(flushBlockBuffer, 1000); // Flush every second
  }
}

async function flushBlockBuffer() {
  blockBufferTimer = null;
  if (blockBuffer.length === 0) return;
  
  // Clone and clear buffer
  const blocksToProcess = [...blockBuffer];
  blockBuffer = [];
  
  try {
    const data = await chrome.storage.local.get(['statistics', 'dailyStats', 'blockLog']);
    
    const statistics = data.statistics || getDefaultStats();
    
    const dailyStats = data.dailyStats || {};
    const blockLog = data.blockLog || [];
    const today = new Date().toISOString().split('T')[0];
    
    if (!dailyStats[today]) {
      dailyStats[today] = { ads: 0, trackers: 0, miners: 0, malware: 0, total: 0 };
    }
    
    // Process all items
    for (const item of blocksToProcess) {
      statistics.totalBlocked++;
      dailyStats[today].total++;
      
      switch (item.type) {
        case 'ad':
          statistics.adsBlocked++; statistics.dataSaved += 50000; statistics.timeSaved += 200;
          dailyStats[today].ads++; break;
        case 'tracker':
          statistics.trackersBlocked++; statistics.dataSaved += 5000; statistics.timeSaved += 50;
          dailyStats[today].trackers++; break;
        case 'miner':
          statistics.minersBlocked++; statistics.dataSaved += 100000; statistics.timeSaved += 1000;
          dailyStats[today].miners++; break;
        case 'malware':
          statistics.malwareBlocked++; statistics.dataSaved += 10000;
          dailyStats[today].malware++; break;
      }
      
      blockLog.unshift({
        url: item.url.substring(0, 200),
        type: item.type,
        source: item.source,
        tabId: item.tabId,
        severity: item.severity,
        timestamp: item.timestamp
      });
    }
    
    if (blockLog.length > 500) blockLog.length = 500;
    
    await chrome.storage.local.set({ statistics, dailyStats, blockLog });
    
    // Broadcast new blocks for the Live Network Log
    for (const item of blocksToProcess) {
      chrome.runtime.sendMessage({
        type: 'NEW_BLOCK_EVENT',
        data: {
          url: item.url.substring(0, 200),
          type: item.type,
          source: item.source,
          tabId: item.tabId,
          severity: item.severity,
          timestamp: item.timestamp
        }
      }).catch(() => {}); // Ignore errors if dashboard is closed
    }
    
    // Update badges efficiently
    const tabCounts = new Map();
    for (const item of blocksToProcess) {
      if (item.tabId > 0) {
        const counts = tabCounts.get(item.tabId) || { total: 0, ad: 0, tracker: 0, other: 0 };
        counts.total++;
        if (item.type === 'ad') counts.ad++;
        else if (item.type === 'tracker') counts.tracker++;
        else counts.other++;
        tabCounts.set(item.tabId, counts);
      }
    }
    
    for (const [tId, count] of tabCounts.entries()) {
      updateTabBadgeBatch(tId, count);
    }
    
  } catch (error) {
    console.error('[BlockForge] Buffer flush error:', error);
  }
}

async function updateTabBadgeBatch(tabId, incrementCounts) {
  try {
    if (!isEnabled) return;
    
    // Check if incrementCounts is a number (legacy fallback) or object
    const isObject = typeof incrementCounts === 'object';
    const incTotal = isObject ? incrementCounts.total : incrementCounts;
    
    const current = tabBlockCounts.get(tabId) || { total: 0, ad: 0, tracker: 0, other: 0 };
    current.total += incTotal;
    if (isObject) {
      current.ad += incrementCounts.ad || 0;
      current.tracker += incrementCounts.tracker || 0;
      current.other += incrementCounts.other || 0;
    }
    
    tabBlockCounts.set(tabId, current);
    
    let badgeText = current.total.toString();
    if (current.total >= 1000) badgeText = Math.floor(current.total / 1000) + 'k';
    
    await chrome.action.setBadgeText({ text: badgeText, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#00ff88', tabId });
  } catch (e) {
    // Tab might be closed
  }
}



// Update global badge
async function updateBadge() {
  try {
    if (!isEnabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#666666' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#00ff88' });
    }
  } catch (e) {
    console.error('Badge update error:', e);
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('Message handling error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

// Normalize message action - handles both 'action' and 'type' properties
// Also converts SCREAMING_SNAKE_CASE to camelCase
function normalizeAction(message) {
  let action = message.action || message.type;
  if (!action) return null;
  
  // Convert SCREAMING_SNAKE_CASE to camelCase
  const actionMap = {
    'GET_SETTINGS': 'getSettings',
    'UPDATE_SETTINGS': 'updateSettings',
    'GET_FILTER_LISTS': 'getFilterLists',
    'TOGGLE_FILTER_LIST': 'toggleFilterList',
    'UPDATE_FILTER_LISTS': 'updateFilterLists',
    'ADD_CUSTOM_FILTER_LIST': 'addCustomFilterList',
    'GET_CUSTOM_RULES': 'getCustomRules',
    'ADD_CUSTOM_RULE': 'addCustomRule',
    'REMOVE_CUSTOM_RULE': 'removeCustomRule',
    'GET_GLOBAL_STATS': 'getStatistics',
    'WHITELIST_SITE': 'whitelistSite',
    'BLACKLIST_SITE': 'blacklistSite',
    'EXPORT_SETTINGS': 'exportSettings',
    'IMPORT_SETTINGS': 'importSettings',
    'RESET_STATISTICS': 'resetStatistics',
    'CLEAR_ALL_DATA': 'clearAllData'
  };
  
  return actionMap[action] || action;
}

async function handleMessage(message, sender) {
  const action = normalizeAction(message);
  console.log('[BlockForge] Message received:', action);
  
  // SECURITY: Validate message sender
  // Only allow specific messages from untrusted content scripts.
  // Sensitive actions (like updateSettings, toggleProtection, blockConnection) MUST originate from an extension page.
  const isExtensionPage = sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
  const allowUntrusted = [
    'injectProtectionScript', 'INJECT_PROTECTION_SCRIPT',
    'contentScriptReady', 'CONTENT_SCRIPT_READY',
    'REPORT_DOM_BLOCKED'
  ];
  
  if (!isExtensionPage && !allowUntrusted.includes(action)) {
    console.warn(`[BlockForge] Security Alert: Blocked unauthorized '${action}' request from untrusted sender:`, sender.url);
    return { error: 'Unauthorized' };
  }
  
  switch (action) {
    case 'injectProtectionScript':
    case 'INJECT_PROTECTION_SCRIPT': {
      // Inject protection script into page context (MAIN world) to bypass CSP
      if (!sender.tab?.id) {
        return { success: false, error: 'No tab ID' };
      }
      
      const targetUrl = sender.url || (sender.tab ? sender.tab.url : '');
      if (!targetUrl || 
          targetUrl.startsWith('chrome://') || 
          targetUrl.startsWith('edge://') || 
          targetUrl.startsWith('about:') || 
          targetUrl.startsWith('chrome-extension://') ||
          targetUrl.startsWith('https://chrome.google.com/webstore')) {
        return { success: false, error: 'Cannot inject into restricted URLs' };
      }
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          injectImmediately: true,
          func: function() {
            // Protection script injected directly into page context
            if (window.__blockforge_injected__) return;
            window.__blockforge_injected__ = true;
            
            const seed = Math.floor(Math.random() * 1000000);
            let seedCounter = seed;
            
            function random() {
              const x = Math.sin(seedCounter++) * 10000;
              return x - Math.floor(x);
            }
            
            // Popup defuser (window.open interceptor)
            if (typeof window.open === 'function') {
              const originalWindowOpen = window.open;
              let userInteracted = false;
              
              // Only allow window.open shortly after a real user interaction
              document.addEventListener('click', () => {
                userInteracted = true;
                setTimeout(() => userInteracted = false, 1500);
              }, true);
              
              document.addEventListener('keydown', () => {
                userInteracted = true;
                setTimeout(() => userInteracted = false, 1500);
              }, true);
              
              window.open = function(url, target, features) {
                const urlStr = (url || '').toString();
                // Block if strictly no user interaction
                if (!userInteracted) {
                  console.warn('[BlockForge] Blocked un-trusted auto-popup without user interaction to:', urlStr);
                  return null;
                }
                return originalWindowOpen.apply(this, arguments);
              };
            }
            
            // Canvas fingerprinting protection
            if (HTMLCanvasElement.prototype.toDataURL) {
              const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
              HTMLCanvasElement.prototype.toDataURL = function() {
                const context = this.getContext('2d');
                if (context) {
                  const imageData = context.getImageData(0, 0, this.width, this.height);
                  for (let i = 0; i < imageData.data.length; i += 4) {
                    imageData.data[i] += (random() - 0.5) * 2;
                  }
                  context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, arguments);
              };
            }
            
            // WebGL fingerprinting protection
            if (WebGLRenderingContext.prototype.getParameter) {
              const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
              WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Intel Inc.';
                if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                return originalGetParameter.apply(this, arguments);
              };
            }
            
            // AudioContext fingerprinting protection
            if (typeof AudioContext !== 'undefined') {
              const OriginalAudioContext = AudioContext;
              window.AudioContext = function() {
                const context = new OriginalAudioContext();
                const originalCreateOscillator = context.createOscillator.bind(context);
                context.createOscillator = function() {
                  const oscillator = originalCreateOscillator();
                  const originalStart = oscillator.start.bind(oscillator);
                  oscillator.start = function() {
                    oscillator.frequency.value += (random() - 0.5) * 0.001;
                    return originalStart.apply(this, arguments);
                  };
                  return oscillator;
                };
                return context;
              };
            }
          }
        });
        return { success: true };
      } catch (error) {
        // Suppress scary console errors for expected navigation race conditions
        if (error.message && (error.message.includes('chrome://') || error.message.includes('edge://') || error.message.includes('about:'))) {
          return { success: false, error: error.message };
        }
        console.error('Failed to inject protection script:', error);
        return { success: false, error: error.message };
      }
    }
    
    case 'contentScriptReady':
    case 'CONTENT_SCRIPT_READY': {
      // Content script is ready, send configuration
      const tabUrl = sender.tab?.url || '';
      const csrHostname = message.hostname || (tabUrl ? new URL(tabUrl).hostname : '');
      const isWhitelisted = (settings.whitelist || []).includes(csrHostname);
      
      // Parse $ghide exceptions for anti-adblock bypass
      const customData = await chrome.storage.local.get(['customRules']);
      const customRules = customData.customRules || [];
      const ghideExceptions = customRules
        .filter(r => r.pattern && r.pattern.includes('$ghide'))
        .map(r => {
           const match = r.pattern.match(/@@\|\|(.*?)(\^|\$)/);
           return match ? match[1] : null;
        })
        .filter(d => d);
      
      const disableCosmetic = ghideExceptions.some(d => csrHostname === d || csrHostname.endsWith('.' + d));

      return {
        success: true,
        config: {
          enabled: isEnabled,
          settings: settings,
          isWhitelisted: isWhitelisted,
          disableCosmetic: disableCosmetic
        }
      };
    }
    
    case 'getStatus':
      const statusData = await chrome.storage.local.get(['statistics']);
      return {
        isEnabled: isEnabled,
        statistics: statusData.statistics || getDefaultStats()
      };
      
    case 'toggleProtection':
      isEnabled = !isEnabled;
      await chrome.storage.local.set({ isEnabled });
      await updateRules();
      await updateBadge();
      return { isEnabled };
      
    case 'getSettings':
      return { settings };
      
    case 'updateSettings':
      const otaJustEnabled = message.settings.otaEnabled === true && !settings.otaEnabled;
      settings = { ...settings, ...message.settings };
      await chrome.storage.local.set({ settings });
      await updateRules();
      if (otaJustEnabled) checkForOTAUpdates(true);
      return { success: true };
      
    case 'forceOtaUpdate':
    case 'FORCE_OTA_UPDATE': {
      try {
        await checkForOTAUpdates(true);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
      
    case 'getStatistics':
      const statsData = await chrome.storage.local.get(['statistics', 'dailyStats', 'blockLog']);
      return {
        statistics: statsData.statistics || getDefaultStats(),
        dailyStats: statsData.dailyStats || {},
        blockLog: statsData.blockLog || []
      };
      
    case 'resetStatistics':
      await chrome.storage.local.set({
        statistics: getDefaultStats(),
        dailyStats: {},
        blockLog: []
      });
      tabBlockCounts.clear();
      return { success: true };
      
    case 'addToWhitelist':
      settings.whitelist = settings.whitelist || [];
      if (!settings.whitelist.includes(message.domain)) {
        settings.whitelist.push(message.domain);
        await chrome.storage.local.set({ settings });
        await updateRules();
      }
      return { success: true };
      
    case 'removeFromWhitelist':
      settings.whitelist = (settings.whitelist || []).filter(d => d !== message.domain);
      await chrome.storage.local.set({ settings });
      await updateRules();
      return { success: true };
      
    // 'getSiteBlocked' removed — use 'getTabBlocked' instead for accurate per-tab filtering
      
    case 'getTabBlocked': {
      // Get blocked items for a specific tab
      const tabData = await chrome.storage.local.get(['blockLog', 'siteExceptions']);
      const tabBlockLog = tabData.blockLog || [];
      const tabExceptions = tabData.siteExceptions || {};
      const tabId = message.tabId;
      const tabHostname = message.hostname;
      
      // Filter blocks for this tab
      const tabBlocked = tabBlockLog.filter(item => item.tabId === tabId);
      const tabAllowed = tabAllowedConnections.get(tabId) || [];
      
      return {
        blockedItems: tabBlocked,
        allowedItems: tabAllowed,
        exceptions: tabExceptions[tabHostname] || [],
        tabStats: tabBlockCounts.get(tabId) || { total: 0, ad: 0, tracker: 0, other: 0 }
      };
    }
      
    case 'blockConnection': {
      // Dynamically block a domain that was previously allowed
      const blockHost = message.domain;
      // We use a dynamic block rule
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [{
            id: 800000 + Math.floor(Math.random() * 100000), // Random ID in 800k range for custom blocks
            priority: 2,
            action: { type: 'block' },
            condition: {
              urlFilter: `||${blockHost}^`,
              resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
            }
          }]
        });
        return { success: true };
      } catch (e) {
        console.error('Failed to add custom block rule:', e);
        return { success: false };
      }
    }
      
    case 'addException': {
      // Add an exception for a specific URL on a site
      const addExData = await chrome.storage.local.get(['siteExceptions']);
      const addExceptions = addExData.siteExceptions || {};
      const addHostname = message.hostname;
      const addUrl = message.url;
      
      if (!addExceptions[addHostname]) {
        addExceptions[addHostname] = [];
      }
      
      if (!addExceptions[addHostname].includes(addUrl)) {
        addExceptions[addHostname].push(addUrl);
        await chrome.storage.local.set({ siteExceptions: addExceptions });
        
        // Add a dynamic allow rule
        await addDynamicAllowRule(addUrl);
      }
      
      return { success: true, exceptions: addExceptions[addHostname] };
    }
      
    case 'removeException': {
      // Remove an exception
      const remExData = await chrome.storage.local.get(['siteExceptions']);
      const remExceptions = remExData.siteExceptions || {};
      const remHostname = message.hostname;
      const remUrl = message.url;
      
      if (remExceptions[remHostname]) {
        remExceptions[remHostname] = remExceptions[remHostname].filter(u => u !== remUrl);
        await chrome.storage.local.set({ siteExceptions: remExceptions });
        
        // Remove the dynamic allow rule
        await removeDynamicAllowRule(remUrl);
      }
      
      return { success: true, exceptions: remExceptions[remHostname] || [] };
    }
    
    // ========== Settings page handlers ==========
    
    case 'getFilterLists': {
      // Return current filter list states with actual rule counts
      let adCount = 0, trackerCount = 0, minerCount = 0, malwareCount = 0;
      try {
        const rulesets = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
        // Use enabled ruleset info if available, otherwise use estimates from our files
        const enabledSets = await chrome.declarativeNetRequest.getEnabledRulesets();
        // We can't get per-ruleset counts easily, so use file-based counts
        adCount = 371; trackerCount = 355; minerCount = 10; malwareCount = 2;
      } catch (e) {
        adCount = 371; trackerCount = 355; minerCount = 10; malwareCount = 2;
      }
      return {
        filterLists: [
          { id: 'ads', name: 'Ad Blocking', enabled: settings.blockAds !== false, rulesCount: adCount },
          { id: 'trackers', name: 'Tracker Blocking', enabled: settings.blockTrackers !== false, rulesCount: trackerCount },
          { id: 'miners', name: 'Crypto Miner Blocking', enabled: settings.blockMiners !== false, rulesCount: minerCount },
          { id: 'malware', name: 'Malware Protection', enabled: settings.blockMalware !== false, rulesCount: malwareCount }
        ]
      };
    }
    
    case 'toggleFilterList':
      // Toggle a specific filter list
      const listId = message.listId || message.id;
      const settingMap = {
        'ads': 'blockAds',
        'trackers': 'blockTrackers',
        'miners': 'blockMiners',
        'malware': 'blockMalware'
      };
      const settingKey = settingMap[listId];
      if (settingKey) {
        settings[settingKey] = message.enabled !== undefined ? message.enabled : !settings[settingKey];
        await chrome.storage.local.set({ settings });
        await updateRules();
      }
      return { success: true, settings };
    
    case 'updateFilterLists':
      // Update all filter lists (refresh from server, etc.)
      await updateRules();
      return { success: true };
    
    case 'addCustomFilterList':
      // Custom filter lists not yet implemented
      return { success: false, error: 'Custom filter lists not yet implemented' };
    
    case 'getCustomRules':
      // Return custom rules from storage
      const customData = await chrome.storage.local.get(['customRules']);
      return { rules: customData.customRules || [] };
    
    case 'addCustomRule':
      // Add a custom blocking rule
      const addRuleData = await chrome.storage.local.get(['customRules']);
      const currentRules = addRuleData.customRules || [];
      const newRule = message.rule;
      if (newRule && newRule.pattern) {
        currentRules.push({
          id: Date.now().toString(), // store as string in storage to avoid ID conflicts, DNR maps to 400000+
          pattern: newRule.pattern,
          type: newRule.type || 'block',
          createdAt: new Date().toISOString()
        });
        await chrome.storage.local.set({ customRules: currentRules });
        await updateRules();
      }
      return { success: true, rules: currentRules };
    
    case 'removeCustomRule':
      // Remove a custom rule
      const removeRuleData = await chrome.storage.local.get(['customRules']);
      let existingCustomRules = removeRuleData.customRules || [];
      existingCustomRules = existingCustomRules.filter(r => 
        r.id !== message.ruleId && r.pattern !== message.pattern
      );
      await chrome.storage.local.set({ customRules: existingCustomRules });
      await updateRules();
      return { success: true, rules: existingCustomRules };
    
    case 'whitelistSite':
      // Add or remove site from whitelist
      settings.whitelist = settings.whitelist || [];
      const whitelistDomain = message.domain || message.site;
      const whitelistAction = message.add !== false; // default to add
      
      if (whitelistAction) {
        if (!settings.whitelist.includes(whitelistDomain)) {
          settings.whitelist.push(whitelistDomain);
        }
      } else {
        settings.whitelist = settings.whitelist.filter(d => d !== whitelistDomain);
      }
      await chrome.storage.local.set({ settings });
      await updateRules();
      return { success: true, whitelist: settings.whitelist };
    
    case 'blacklistSite':
      // Add or remove site from blacklist
      settings.blacklist = settings.blacklist || [];
      const blacklistDomain = message.domain || message.site;
      const blacklistAction = message.add !== false;
      
      if (blacklistAction) {
        if (!settings.blacklist.includes(blacklistDomain)) {
          settings.blacklist.push(blacklistDomain);
        }
      } else {
        settings.blacklist = settings.blacklist.filter(d => d !== blacklistDomain);
      }
      await chrome.storage.local.set({ settings });
      await updateRules();
      return { success: true, blacklist: settings.blacklist };
    
    case 'exportSettings':
      // Export all settings and data
      const exportData = await chrome.storage.local.get(null);
      return {
        settings: exportData.settings || settings,
        whitelist: settings.whitelist || [],
        blacklist: settings.blacklist || [],
        customRules: exportData.customRules || [],
        statistics: exportData.statistics || {},
        exportDate: new Date().toISOString(),
        version: chrome.runtime.getManifest().version
      };
    
    case 'importSettings':
      // Import settings from backup
      const importData = message.data;
      if (importData) {
        if (importData.settings) {
          settings = { ...settings, ...importData.settings };
        }
        if (importData.whitelist) {
          settings.whitelist = importData.whitelist;
        }
        if (importData.blacklist) {
          settings.blacklist = importData.blacklist;
        }
        await chrome.storage.local.set({ 
          settings,
          customRules: importData.customRules || []
        });
        await updateRules();
      }
      return { success: true };
    
    case 'clearAllData':
      // Clear all stored data
      await chrome.storage.local.clear();
      
      // Clear all dynamic rules
      const existingDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
      if (existingDynamicRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existingDynamicRules.map(r => r.id)
        });
      }
      
      settings = {
        blockAds: true,
        blockTrackers: true,
        blockMiners: true,
        blockMalware: true,
        showBadge: true,
        whitelist: [],
        blacklist: []
      };
      await chrome.storage.local.set({ settings, isEnabled: true });
      await updateRules();
      await updateBadge();
      return { success: true };
      
    default:
      console.log('[BlockForge] ️ Unknown action:', action);
      return { error: 'Unknown action: ' + action };
  }
}

// Dynamic rule management for exceptions
let dynamicRuleId = 1000000; // Start high to avoid conflicts

async function addDynamicAllowRule(url) {
  try {
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // Get current dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    
    // Compute safe next rule ID to avoid conflicts on extension restart
    let ruleId = dynamicRuleId++;
    if (existingRules.length > 0) {
      const maxId = Math.max(...existingRules.map(r => r.id));
      if (maxId >= ruleId) {
        ruleId = maxId + 1;
        dynamicRuleId = ruleId + 1;
      }
    }
    
    // Create allow rule
    const rule = {
      id: ruleId,
      priority: 1, // High priority to override block rules
      action: { type: 'allow' },
      condition: {
        urlFilter: url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // Escape special chars
        resourceTypes: ['script', 'image', 'stylesheet', 'font', 'xmlhttprequest', 'sub_frame', 'object', 'ping', 'other']
      }
    };
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [rule]
    });
    
    // Store the rule ID mapping
    const ruleMap = (await chrome.storage.local.get(['exceptionRuleMap'])).exceptionRuleMap || {};
    ruleMap[url] = ruleId;
    await chrome.storage.local.set({ exceptionRuleMap: ruleMap });
    
    console.log('[BlockForge] Added allow rule for:', url);
  } catch (error) {
    console.error('[BlockForge] Failed to add allow rule:', error);
  }
}

async function removeDynamicAllowRule(url) {
  try {
    const ruleMap = (await chrome.storage.local.get(['exceptionRuleMap'])).exceptionRuleMap || {};
    const ruleId = ruleMap[url];
    
    if (ruleId) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId]
      });
      
      delete ruleMap[url];
      await chrome.storage.local.set({ exceptionRuleMap: ruleMap });
      
      console.log('[BlockForge] Removed allow rule for:', url);
    }
  } catch (error) {
    console.error('[BlockForge] Failed to remove allow rule:', error);
  }
}

// Handle tab updates - reset count on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabBlockCounts.delete(tabId);
    tabAllowedConnections.delete(tabId);
  }
});

// Handle tab removal - cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockCounts.delete(tabId);
  tabAllowedConnections.delete(tabId);
});

// Advanced Network Monitor
const tabAllowedConnections = new Map();

function getHostFromUrl(url) {
  try { return new URL(url).hostname; } catch(e) { return ''; }
}

if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (!isEnabled || details.tabId <= 0 || !details.url.startsWith('http')) return;
    
    const tabId = details.tabId;
    const targetHost = getHostFromUrl(details.url);
    const initiatorHost = details.initiator ? getHostFromUrl(details.initiator) : '';
    
    // Only track third-party connections
    if (targetHost && initiatorHost && !targetHost.endsWith(initiatorHost) && !initiatorHost.endsWith(targetHost)) {
      let connections = tabAllowedConnections.get(tabId) || [];
      
      // Only log unique target domains per tab
      if (!connections.some(c => getHostFromUrl(c.url) === targetHost)) {
        connections.push({
          url: details.url,
          type: 'allowed',
          source: details.initiator,
          tabId: tabId,
          timestamp: Date.now()
        });
        
        // Cap at 100 to prevent memory leaks
        if (connections.length > 100) connections.shift();
        tabAllowedConnections.set(tabId, connections);
      }
    }
  }, { urls: ["<all_urls>"] });
}

// Handle installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[BlockForge] BlockForge installed!');
    
    // Set default values safely
    try {
      await chrome.storage.local.set({
        isEnabled: true,
        settings: getDefaultSettings(),
        statistics: getDefaultStats(),
        dailyStats: {},
        blockLog: []
      });
    } catch (error) {
      console.error('[BlockForge] Failed to set default settings on install:', error);
    }
    
    // Open welcome page
    try {
      chrome.tabs.create({ url: 'welcome/welcome.html' });
    } catch (e) {
      console.log('Could not open welcome page');
    }
  } else if (details.reason === 'update') {
    console.log('[BlockForge] BlockForge updated to version', chrome.runtime.getManifest().version);
  }
});

// Initialize on startup
initialize();

// ==========================================
// OTA UPDATES
// ==========================================
const USE_LOCAL_TESTING = false; // Change this to false before publishing to Chrome Web Store!
const OTA_URL = USE_LOCAL_TESTING 
  ? "http://localhost:8080/ota-rules.json"
  : "https://raw.githubusercontent.com/saksham-dev07/blockforge/main/ota-rules.json";

const OTA_ALARM_NAME = "checkOTAUpdates";
const OTA_INTERVAL_MINUTES = 24 * 60; // 24 hours

async function checkForOTAUpdates(force = false) {
  if (!settings.otaEnabled) return;

  try {
    const data = await chrome.storage.local.get(['lastOTAUpdate']);
    const lastUpdate = data.lastOTAUpdate || 0;
    const now = Date.now();
    
    // Only check if it's been more than 24 hours, or if forced
    if (!force && now - lastUpdate < OTA_INTERVAL_MINUTES * 60 * 1000) {
      setupOTAAlarm();
      return;
    }
    
    console.log('[BlockForge] Checking for OTA filter updates...');
    
    // Fetch rules from remote
    const response = await fetch(OTA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const otaRules = await response.json();
    if (!Array.isArray(otaRules)) throw new Error('Invalid OTA rules format');
    
    // Validate rules
    const validRules = otaRules.filter(r => r && r.action && r.condition);
    if (validRules.length === 0) return;
    
    // Apply rules to DNR (IDs 600000 - 629000)
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldOtaRuleIds = existingRules
      .filter(r => r.id >= 600000 && r.id < 630000)
      .map(r => r.id);
      
    // Enforce ID limits on new rules
    const formattedRules = validRules.map((rule, index) => {
      rule.id = 600000 + index;
      return rule;
    }).slice(0, 29000);
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldOtaRuleIds,
      addRules: formattedRules
    });
    
    await chrome.storage.local.set({ lastOTAUpdate: now });
    console.log(`[BlockForge] Applied ${formattedRules.length} OTA rules successfully.`);
    
    setupOTAAlarm();
  } catch (error) {
    console.error('[BlockForge] OTA Update failed:', error);
    // Retry in an hour on failure
    chrome.alarms.create(OTA_ALARM_NAME, { delayInMinutes: 60 });
  }
}

function setupOTAAlarm() {
  chrome.alarms.create(OTA_ALARM_NAME, { periodInMinutes: OTA_INTERVAL_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OTA_ALARM_NAME) {
    checkForOTAUpdates(true);
  }
});

console.log('[BlockForge] BlockForge service worker loaded');

// Start extension
initialize();

