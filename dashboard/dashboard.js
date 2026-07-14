
/**
 * BlockForge - Enhanced Dashboard Script
 * Advanced analytics and detailed statistics
 */

// State
let statistics = {};
let dailyStats = {};
let blockLog = [];
let hourlyStats = {};
let siteStats = {};
let requestTypes = {};
let sessionStartTime = Date.now();

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
  await loadData();
  setupEventListeners();
  startAutoRefresh();
  updateFooterTime();
});

/**
 * Load dashboard data
 */
async function loadData() {
  try {
    const response = await safeSendMessage({ action: 'getStatistics' });
    
    if (response) {
      statistics = response.statistics || {};
      dailyStats = response.dailyStats || {};
      blockLog = response.blockLog || [];
    }
    
    // Process additional stats from block log
    processBlockLog();
    updateUI();
    updateLastUpdated();
  } catch (error) {
    console.error('Failed to load data:', error);
    // Fallback to storage
    const data = await chrome.storage.local.get(['statistics', 'dailyStats', 'blockLog']);
    statistics = data.statistics || {};
    dailyStats = data.dailyStats || {};
    blockLog = data.blockLog || [];
    processBlockLog();
    updateUI();
  }
}

/**
 * Process block log for additional statistics
 */
function processBlockLog() {
  hourlyStats = {};
  siteStats = {};
  requestTypes = {};
  
  blockLog.forEach(block => {
    // Hourly stats
    const hour = new Date(block.timestamp).getHours();
    hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
    
    // Site stats (source site)
    if (block.source) {
      const sourceDomain = extractDomain(block.source);
      if (!siteStats[sourceDomain]) {
        siteStats[sourceDomain] = { total: 0, ads: 0, trackers: 0, miners: 0, malware: 0 };
      }
      siteStats[sourceDomain].total++;
      if (block.type === 'ad') siteStats[sourceDomain].ads++;
      else if (block.type === 'tracker') siteStats[sourceDomain].trackers++;
      else if (block.type === 'miner') siteStats[sourceDomain].miners++;
      else if (block.type === 'malware') siteStats[sourceDomain].malware++;
    }
    
    // Request types
    const reqType = block.resourceType || 'other';
    requestTypes[reqType] = (requestTypes[reqType] || 0) + 1;
  });
}

/**
 * Update all UI elements
 */
function updateUI() {
  updateOverviewCards();
  updateSecondaryStats();
  updateCategoryChart();
  updateTrendsChart();
  updateHourlyChart();
  updateProtectionSummary();
  updateRecentBlocks();
  updateTopDomains();
  updateTopSites();
  updateRequestTypes();
  updatePrivacyScore();
  renderLiveLogTable();
}

/**
 * Update overview stat cards
 */
function updateOverviewCards() {
  const total = statistics.totalBlocked || 0;
  
  // Total blocked
  const totalEl = document.getElementById('totalBlocked');
  if (totalEl) totalEl.textContent = formatNumber(total);
  
  // Ads blocked
  const adsEl = document.getElementById('adsBlocked');
  const adsPercEl = document.getElementById('adsPercent');
  const ads = statistics.adsBlocked || 0;
  if (adsEl) adsEl.textContent = formatNumber(ads);
  if (adsPercEl) adsPercEl.textContent = total > 0 ? Math.round(ads / total * 100) + '%' : '0%';
  
  // Trackers blocked
  const trackersEl = document.getElementById('trackersBlocked');
  const trackersPercEl = document.getElementById('trackersPercent');
  const trackers = statistics.trackersBlocked || 0;
  if (trackersEl) trackersEl.textContent = formatNumber(trackers);
  if (trackersPercEl) trackersPercEl.textContent = total > 0 ? Math.round(trackers / total * 100) + '%' : '0%';
  
  // Miners blocked
  const minersEl = document.getElementById('minersBlocked');
  const minersPercEl = document.getElementById('minersPercent');
  const miners = statistics.minersBlocked || 0;
  if (minersEl) minersEl.textContent = formatNumber(miners);
  if (minersPercEl) minersPercEl.textContent = total > 0 ? Math.round(miners / total * 100) + '%' : '0%';
  
  // Malware blocked
  const malwareEl = document.getElementById('malwareBlocked');
  const malwarePercEl = document.getElementById('malwarePercent');
  const malware = statistics.malwareBlocked || 0;
  if (malwareEl) malwareEl.textContent = formatNumber(malware);
  if (malwarePercEl) malwarePercEl.textContent = total > 0 ? Math.round(malware / total * 100) + '%' : '0%';
  
  // Data saved
  const dataEl = document.getElementById('dataSaved');
  if (dataEl) dataEl.textContent = formatBytes(statistics.dataSaved || 0);
  
  // Time saved
  const timeEl = document.getElementById('timeSaved');
  if (timeEl) timeEl.textContent = formatTime(statistics.timeSaved || 0);
  
  // Trend calculation
  const trendEl = document.getElementById('totalTrend');
  if (trendEl) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const todayBlocks = dailyStats[today]?.total || 0;
    const yesterdayBlocks = dailyStats[yesterday]?.total || 0;
    
    if (yesterdayBlocks > 0) {
      const change = Math.round((todayBlocks - yesterdayBlocks) / yesterdayBlocks * 100);
      const icon = change >= 0 ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>' : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>';
      trendEl.innerHTML = `<span class="trend-icon">${icon}</span><span class="trend-text">${change >= 0 ? '+' : ''}${change}% vs yesterday</span>`;
    } else if (todayBlocks > 0) {
      trendEl.innerHTML = `<span class="trend-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></span><span class="trend-text">${todayBlocks} blocked today</span>`;
    }
  }
}

/**
 * Update secondary stats
 */
function updateSecondaryStats() {
  // Sites visited/protected
  const sitesEl = document.getElementById('sitesVisited');
  if (sitesEl) sitesEl.textContent = formatNumber(Object.keys(siteStats).length);
  
  // Average blocks per page
  const avgEl = document.getElementById('avgPerPage');
  const siteCount = Object.keys(siteStats).length;
  if (avgEl) {
    const avg = siteCount > 0 ? Math.round((statistics.totalBlocked || 0) / siteCount) : 0;
    avgEl.textContent = formatNumber(avg);
  }
  
  // Blocks today
  const todayEl = document.getElementById('blocksToday');
  const today = new Date().toISOString().split('T')[0];
  if (todayEl) todayEl.textContent = formatNumber(dailyStats[today]?.total || 0);
  
  // Active days
  const daysEl = document.getElementById('activeDays');
  if (daysEl) daysEl.textContent = formatNumber(Object.keys(dailyStats).length);
}

/**
 * Update category breakdown chart
 */
function updateCategoryChart() {
  const container = document.getElementById('categoryChart');
  if (!container) return;
  
  const total = (statistics.adsBlocked || 0) + 
                (statistics.trackersBlocked || 0) + 
                (statistics.minersBlocked || 0) + 
                (statistics.malwareBlocked || 0);
  
  if (total === 0) {
    container.innerHTML = '<div class="no-data">No data yet. Start browsing to see statistics.</div>';
    return;
  }
  
  const categories = [
    { name: 'Ads', value: statistics.adsBlocked || 0, color: '#ef4444', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>' },
    { name: 'Trackers', value: statistics.trackersBlocked || 0, color: '#f59e0b', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' },
    { name: 'Miners', value: statistics.minersBlocked || 0, color: '#2563eb', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 11"></path><path d="M17.64 15L22 10.64"></path><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H11.2l-2.8 2.8c-.8.8-.8 2.1 0 2.9l8 8c.8.8 2.1.8 2.9 0l1.6-1.6c.8-.8.8-2.1 0-2.9Z"></path></svg>' },
    { name: 'Malware', value: statistics.malwareBlocked || 0, color: '#3b82f6', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' }
  ];
  
  let html = '<div class="category-cards">';
  
  categories.forEach(cat => {
    const percent = total > 0 ? (cat.value / total * 100).toFixed(1) : 0;
    html += `
      <div class="category-card" style="--cat-color: ${cat.color}">
        <div class="category-icon">${cat.icon}</div>
        <div class="category-info">
          <div class="category-name">${cat.name}</div>
          <div class="category-value">${formatNumber(cat.value)}</div>
        </div>
        <div class="category-bar-wrap">
          <div class="category-bar" style="width: ${percent}%; background: ${cat.color}"></div>
        </div>
        <div class="category-percent">${percent}%</div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update trends chart
 */
function updateTrendsChart() {
  const container = document.getElementById('trendsChart');
  if (!container) return;
  
  const rangeSelect = document.getElementById('trendsRange');
  const range = rangeSelect ? parseInt(rangeSelect.value) : 7;
  
  // Get days
  const days = [];
  for (let i = range - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    const dayName = range <= 7 
      ? date.toLocaleDateString('en-US', { weekday: 'short' })
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    days.push({
      key,
      label: dayName,
      data: dailyStats[key] || { total: 0, ads: 0, trackers: 0 }
    });
  }
  
  const maxValue = Math.max(...days.map(d => d.data.total), 1);
  const totalBlocks = days.reduce((sum, d) => sum + d.data.total, 0);
  const avgBlocks = Math.round(totalBlocks / days.length);
  
  let html = `
    <div class="trends-summary">
      <div class="trend-stat">
        <span class="trend-stat-value">${formatNumber(totalBlocks)}</span>
        <span class="trend-stat-label">Total (${range} days)</span>
      </div>
      <div class="trend-stat">
        <span class="trend-stat-value">${formatNumber(avgBlocks)}</span>
        <span class="trend-stat-label">Daily Average</span>
      </div>
    </div>
    <div class="line-chart">
      <div class="chart-bars">
  `;
  
  days.forEach(day => {
    const height = day.data.total > 0 ? Math.max((day.data.total / maxValue * 100), 8) : 5;
    const hasData = day.data.total > 0;
    html += `
      <div class="chart-bar-group" title="${day.key}: ${day.data.total} blocks">
        <div class="chart-bar ${hasData ? '' : 'empty'}" style="height: ${height}%">
          <span class="chart-bar-value">${day.data.total}</span>
        </div>
        <span class="chart-bar-label">${day.label}</span>
      </div>
    `;
  });
  
  html += '</div></div>';
  container.innerHTML = html;
}

/**
 * Update hourly activity chart
 */
function updateHourlyChart() {
  const container = document.getElementById('hourlyChart');
  if (!container) return;
  
  const hours = [];
  for (let i = 0; i < 24; i++) {
    hours.push({ hour: i, count: hourlyStats[i] || 0 });
  }
  
  const maxCount = Math.max(...hours.map(h => h.count), 1);
  const peakHour = hours.reduce((max, h) => h.count > max.count ? h : max, hours[0]);
  
  let html = `
    <div class="hourly-summary">
      <span class="peak-hour">Peak: ${formatHour(peakHour.hour)} (${peakHour.count} blocks)</span>
    </div>
    <div class="hourly-bars">
  `;
  
  hours.forEach(h => {
    const height = h.count > 0 ? Math.max((h.count / maxCount * 100), 3) : 2;
    const isPeak = h.hour === peakHour.hour && peakHour.count > 0;
    html += `
      <div class="hourly-bar ${isPeak ? 'peak' : ''}" 
           style="height: ${height}%" 
           title="${formatHour(h.hour)}: ${h.count} blocks">
      </div>
    `;
  });
  
  html += '</div><div class="hourly-labels"><span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span></div>';
  container.innerHTML = html;
}

/**
 * Update protection summary
 */
function updateProtectionSummary() {
  const container = document.getElementById('protectionSummary');
  if (!container) return;
  
  const total = statistics.totalBlocked || 0;
  const today = new Date().toISOString().split('T')[0];
  const todayBlocks = dailyStats[today]?.total || 0;
  
  const summaryItems = [
    { label: 'Total Threats Blocked', value: formatNumber(total), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>' },
    { label: 'Blocked Today', value: formatNumber(todayBlocks), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>' },
    { label: 'Sites Protected', value: formatNumber(Object.keys(siteStats).length), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' },
    { label: 'Data Saved', value: formatBytes(statistics.dataSaved || 0), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>' },
    { label: 'Time Saved', value: formatTime(statistics.timeSaved || 0), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>' },
    { label: 'Active Days', value: formatNumber(Object.keys(dailyStats).length), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>' }
  ];
  
  let html = '<div class="summary-grid">';
  
  summaryItems.forEach(item => {
    html += `
      <div class="summary-item">
        <span class="summary-icon">${item.icon}</span>
        <div class="summary-content">
          <span class="summary-value">${item.value}</span>
          <span class="summary-label">${item.label}</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update recent blocks log
 */
function updateRecentBlocks() {
  const container = document.getElementById('recentBlocks');
  const badgeEl = document.getElementById('totalBlocksBadge');
  if (!container) return;
  
  if (badgeEl) badgeEl.textContent = `${blockLog.length} blocks`;
  
  if (blockLog.length === 0) {
    container.innerHTML = '<div class="no-data">No blocked requests yet.</div>';
    return;
  }
  
  const recent = blockLog.slice(0, 30);
  
  let html = '<div class="block-log">';
  
  recent.forEach(block => {
    const time = new Date(block.timestamp).toLocaleTimeString();
    const domain = escapeHTML(extractDomain(block.url));
    const safeUrl = escapeHTML(block.url);
    const typeClass = escapeHTML(block.type || 'unknown');
    const typeLabel = escapeHTML(block.type ? block.type.charAt(0).toUpperCase() + block.type.slice(1) : 'Unknown');
    
    html += `
      <div class="log-item">
        <span class="log-type ${typeClass}">${typeLabel}</span>
        <span class="log-domain" title="${safeUrl}">${domain}</span>
        <span class="log-time">${time}</span>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update top blocked domains
 */
function updateTopDomains() {
  const container = document.getElementById('topDomains');
  const badgeEl = document.getElementById('totalDomains');
  if (!container) return;
  
  const domainCounts = {};
  blockLog.forEach(block => {
    const domain = extractDomain(block.url);
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  });
  
  const sorted = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  
  if (badgeEl) badgeEl.textContent = `${Object.keys(domainCounts).length} domains`;
  
  if (sorted.length === 0) {
    container.innerHTML = '<div class="no-data">No domains blocked yet.</div>';
    return;
  }
  
  const maxCount = sorted[0][1];
  
  let html = '<div class="domain-list">';
  
  sorted.forEach(([domain, count], index) => {
    const width = (count / maxCount * 100);
    const safeDomain = escapeHTML(domain);
    html += `
      <div class="domain-item">
        <span class="domain-rank">${index + 1}</span>
        <div class="domain-info">
          <span class="domain-name" title="${safeDomain}">${safeDomain}</span>
          <div class="domain-bar">
            <div class="domain-bar-fill" style="width: ${width}%"></div>
          </div>
        </div>
        <span class="domain-count">${count}</span>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update top sites protected
 */
function updateTopSites() {
  const container = document.getElementById('topSites');
  if (!container) return;
  
  const sorted = Object.entries(siteStats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  
  if (sorted.length === 0) {
    container.innerHTML = '<div class="no-data">No site data yet.</div>';
    return;
  }
  
  let html = '<div class="site-list">';
  
  sorted.forEach(([site, stats], index) => {
    html += `
      <div class="site-item">
        <span class="site-rank">${index + 1}</span>
        <div class="site-info">
          <span class="site-name">${site}</span>
          <div class="site-breakdown">
            ${stats.ads > 0 ? `<span class="site-tag ad">${stats.ads} ads</span>` : ''}
            ${stats.trackers > 0 ? `<span class="site-tag tracker">${stats.trackers} trackers</span>` : ''}
            ${stats.miners > 0 ? `<span class="site-tag miner">${stats.miners} miners</span>` : ''}
          </div>
        </div>
        <span class="site-count">${stats.total}</span>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update request types chart
 */
function updateRequestTypes() {
  const container = document.getElementById('requestTypesChart');
  if (!container) return;
  
  const types = Object.entries(requestTypes).sort((a, b) => b[1] - a[1]);
  
  if (types.length === 0) {
    container.innerHTML = '<div class="no-data">No request type data yet.</div>';
    return;
  }
  
  const total = types.reduce((sum, [, count]) => sum + count, 0);
  const typeColors = {
    'script': '#ef4444',
    'image': '#f59e0b',
    'xmlhttprequest': '#2563eb',
    'sub_frame': '#2563eb',
    'stylesheet': '#2563eb',
    'font': '#3b82f6',
    'media': '#14b8a6',
    'other': '#71717a'
  };
  
  let html = '<div class="request-types-grid">';
  
  types.forEach(([type, count]) => {
    const percent = ((count / total) * 100).toFixed(1);
    const color = typeColors[type] || typeColors.other;
    const label = formatRequestType(type);
    
    html += `
      <div class="request-type-item">
        <div class="request-type-bar" style="--bar-width: ${percent}%; --bar-color: ${color}">
          <span class="request-type-name">${label}</span>
          <span class="request-type-count">${formatNumber(count)} (${percent}%)</span>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Update privacy score
 */
function updatePrivacyScore() {
  const scoreCircle = document.getElementById('scoreCircle');
  const scoreValue = document.getElementById('scoreValue');
  
  // Calculate scores based on blocking activity
  const hasActivity = (statistics.totalBlocked || 0) > 0;
  
  // Base score starts at 100, but we calculate protection effectiveness
  const adScore = hasActivity && (statistics.adsBlocked || 0) > 0 ? 95 : 70;
  const trackerScore = hasActivity && (statistics.trackersBlocked || 0) > 0 ? 98 : 75;
  const malwareScore = hasActivity ? 100 : 85;
  const miningScore = hasActivity && (statistics.minersBlocked || 0) > 0 ? 100 : 90;
  
  const overallScore = Math.round((adScore + trackerScore + malwareScore + miningScore) / 4);
  
  // Update circle
  if (scoreCircle) {
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (overallScore / 100) * circumference;
    scoreCircle.style.strokeDasharray = `${circumference}`;
    scoreCircle.style.strokeDashoffset = `${offset}`;
  }
  
  if (scoreValue) scoreValue.textContent = overallScore;
  
  // Update individual scores
  const updateScoreBar = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${value}%`;
  };
  
  updateScoreBar('adScore', adScore);
  updateScoreBar('trackerScore', trackerScore);
  updateScoreBar('malwareScore', malwareScore);
  updateScoreBar('miningScore', miningScore);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', loadData);
  
  // Settings button
  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Reset stats button
  document.getElementById('resetStats')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset ALL statistics? This cannot be undone.')) {
      await safeSendMessage({ action: 'resetStatistics' });
      await loadData();
    }
  });
  
  // Clear log button
  document.getElementById('clearLogBtn')?.addEventListener('click', async () => {
    if (confirm('Clear the block log? Statistics will be preserved.')) {
      await chrome.storage.local.set({ blockLog: [] });
      blockLog = [];
      processBlockLog();
      updateUI();
    }
  });
  
  // Export data button
  document.getElementById('exportData')?.addEventListener('click', exportData);
  
  // Trends range selector
  document.getElementById('trendsRange')?.addEventListener('change', updateTrendsChart);
  
  // Category time range selector
  // Category time range selector
  document.getElementById('categoryTimeRange')?.addEventListener('change', updateCategoryChart);
  
  // Listen for live block events from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'NEW_BLOCK_EVENT' && message.data) {
      addLiveLogRow(message.data, true);
    }
  });
}

// ============================================================================
// LIVE NETWORK LOG
// ============================================================================

/**
 * Render the live network log table
 */
function renderLiveLogTable() {
  const tbody = document.getElementById('liveLogBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // Only render up to 100 items initially to keep DOM light
  const itemsToRender = blockLog.slice(0, 100);
  
  if (itemsToRender.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #71717a; padding: 20px;">No blocks recorded yet in this session.</td></tr>';
    return;
  }
  
  itemsToRender.forEach(block => addLiveLogRow(block, false));
}

/**
 * Add a single row to the live log table
 */
function addLiveLogRow(block, prepend = false) {
  const tbody = document.getElementById('liveLogBody');
  if (!tbody) return;
  
  // Remove the "No blocks" message if it exists
  if (tbody.children.length === 1 && tbody.firstElementChild.innerText.includes('No blocks recorded')) {
    tbody.innerHTML = '';
  }
  
  const tr = document.createElement('tr');
  
  // Format time
  const date = new Date(block.timestamp || Date.now());
  const timeStr = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  // Badge styling
  let badgeClass = 'badge-other';
  let badgeText = 'Other';
  
  if (block.type === 'ad') { badgeClass = 'badge-ad'; badgeText = 'Ad'; }
  else if (block.type === 'tracker') { badgeClass = 'badge-tracker'; badgeText = 'Tracker'; }
  else if (block.type === 'miner') { badgeClass = 'badge-miner'; badgeText = 'Miner'; }
  else if (block.type === 'malware') { badgeClass = 'badge-malware'; badgeText = 'Malware'; }
  
  // Severity Mapping
  const severity = block.severity || 'low';
  const severityClass = `badge-${severity}`;
  const severityText = severity.charAt(0).toUpperCase() + severity.slice(1);
  
  // Safe extraction of domains/urls
  const sourceDomain = block.source ? escapeHTML(extractDomain(block.source)) : 'Unknown';
  const targetUrl = escapeHTML(block.url || 'Unknown');
  const safeDomain = escapeHTML(extractDomain(block.url || ''));
  
  tr.innerHTML = `
    <td class="col-time">${timeStr}</td>
    <td><span class="badge ${badgeClass}">${badgeText}</span></td>
    <td><span class="badge ${severityClass}">${severityText}</span></td>
    <td class="col-domain" title="${escapeHTML(block.source)}">${sourceDomain}</td>
    <td class="col-url" title="${targetUrl}">${targetUrl}</td>
    <td>
      <button class="action-btn-small" onclick="window.addException('${safeDomain}')" title="Allow Domain">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </button>
    </td>
  `;
  
  if (prepend) {
    tr.classList.add('new-row-glow');
    tbody.prepend(tr);
    
    // Trim DOM if it exceeds 100 rows
    if (tbody.children.length > 100) {
      tbody.lastElementChild.remove();
    }
  } else {
    tbody.appendChild(tr);
  }
}

/**
 * Export statistics as JSON
 */
function exportData() {
  const data = {
    exportDate: new Date().toISOString(),
    statistics,
    dailyStats,
    hourlyStats,
    siteStats,
    requestTypes,
    recentBlocks: blockLog.slice(0, 100)
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `BlockForge-stats-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Auto refresh
 */
function startAutoRefresh() {
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadData();
    }
  }, 10000);
}

/**
 * Update footer timestamps
 */
function updateFooterTime() {
  const sessionEl = document.getElementById('sessionStart');
  if (sessionEl) {
    sessionEl.textContent = new Date(sessionStartTime).toLocaleTimeString();
  }
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) {
    el.textContent = new Date().toLocaleTimeString();
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

function formatTime(ms) {
  if (ms < 1000) return ms + 'ms';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  return hours + 'h ' + (minutes % 60) + 'm';
}

function formatHour(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  return `${h}${suffix}`;
}

function formatRequestType(type) {
  const labels = {
    'script': 'Scripts',
    'image': 'Images',
    'xmlhttprequest': 'XHR/Fetch',
    'sub_frame': 'iFrames',
    'stylesheet': 'Stylesheets',
    'font': 'Fonts',
    'media': 'Media',
    'websocket': 'WebSocket',
    'other': 'Other'
  };
  return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function extractDomain(url) {
  if (!url || url === '' || url === 'undefined' || url === 'null') {
    return 'Unknown';
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname || 'Unknown';
  } catch {
    // Fallback for malformed URLs
    const match = url.match(/(?:https?:\/\/)?([^\/\s]+)/);
    const domain = match ? match[1] : url.substring(0, 30);
    return domain || 'Unknown';
  }
}

