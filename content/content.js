/**
 * BlockForge - Content Script (Optimized)
 * 
 * Runs on every page to:
 * - Apply cosmetic CSS filters (pre-render hiding)
 * - Monitor for dynamic ad insertion via MutationObserver
 * - Inject privacy protection scripts
 * - YouTube-specific ad skipping
 * - Communicate with background script
 */

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__blockforge_content_loaded__) return;
  window.__blockforge_content_loaded__ = true;
  
  // Track if extension context is still valid
  let extensionContextValid = true;
  
  function isExtensionContextValid() {
    try {
      return extensionContextValid && chrome.runtime && chrome.runtime.id;
    } catch (e) {
      extensionContextValid = false;
      return false;
    }
  }
  
  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  
  const config = {
    enabled: true,
    settings: {},
    hostname: window.location.hostname,
    isWhitelisted: false,
    disableCosmetic: false
  };
  
  const pageStats = {
    elementsRemoved: 0,
    elementsHidden: 0,
    scriptsBlocked: 0,
    threats: []
  };
  
  // ============================================================================
  // SHARED CONSTANTS (single source of truth)
  // ============================================================================
  
  // Common ad sizes (width x height) — used for iframe/image detection
  const AD_SIZES = [
    [728, 90], [300, 250], [336, 280], [160, 600], [120, 600],
    [468, 60], [320, 50], [320, 100], [970, 90], [970, 250],
    [300, 600], [250, 250], [200, 200], [180, 150], [125, 125],
    [120, 240], [234, 60], [88, 31], [120, 90], [120, 60],
    [300, 50], [320, 480], [480, 320], [300, 1050], [970, 66],
    [980, 120], [980, 90], [950, 90], [930, 180], [750, 300],
    [750, 200], [750, 100]
  ];
  
  // Ad keywords in URLs — used for image/iframe/element heuristic detection
  const AD_KEYWORDS = [
    'ad', 'ads', 'advert', 'banner', 'sponsor', 'promo', 'affiliate',
    'click', 'track', 'pixel', 'beacon', 'impression', 'creatives',
    'campaign', 'placement', 'adserver', 'adnetwork', 'doubleclick',
    'adsystem', 'adservice', 'pagead', 'pubads', 'showad', 'displayad',
    'native-ad', 'content-ad', 'promoted', 'recommended', 'outbrain',
    'taboola', 'revcontent', 'mgid', '728x90', '300x250', '160x600',
    '320x50', '970x90', '300x600', 'leaderboard', 'skyscraper', 'rectangle'
  ];
  
  // Tracking scripts patterns
  const trackingScriptPatterns = [
    /google-analytics\.com/,
    /googletagmanager\.com/,
    /facebook\.net.*\/signals/,
    /connect\.facebook\.net/,
    /platform\.twitter\.com/,
    /analytics\./,
    /tracking\./,
    /telemetry\./,
    /beacon\./,
    /pixel\./
  ];
  
  // Fingerprinting API patterns
  const fingerprintPatterns = [
    'toDataURL', 'getImageData', 'measureText',
    'getContext("webgl")', 'AudioContext', 'OfflineAudioContext',
    'navigator.plugins', 'navigator.mimeTypes', 'getBoundingClientRect'
  ];
  
  // ============================================================================
  // SITE CLASSIFICATION
  // ============================================================================
  
  const testSitePatterns = [
    /^(www\.)?adblock-tester\.com$/,
    /^(www\.)?d3ward\.github\.io$/,
    /^d3\.github\.io$/,
    /^(www\.)?canblock\.com$/,
    /^(www\.)?blockads\.fivefilters\.org$/
  ];
  
  const sensitiveDomainsPatterns = [
    /^(www\.)?google\.(com|[a-z]{2,3})$/,
    /^(www\.)?youtube\.(com|[a-z]{2,3})$/,
    /^(www\.)?gmail\.(com|[a-z]{2,3})$/,
    /^(www\.)?drive\.google\.com$/,
    /^(www\.)?docs\.google\.com$/,
    /^(www\.)?github\.(com|io)$/,
    /^(www\.)?stackoverflow\.com$/,
    /^(www\.)?reddit\.com$/,
    /^(www\.)?twitter\.com$/,
    /^(www\.)?x\.com$/,
    /^(www\.)?facebook\.com$/,
    /^(www\.)?instagram\.com$/,
    /^(www\.)?linkedin\.com$/,
    /^(.*\.)?banking/,
    /^(.*\.)?bank\./,
    /^(.*\.)?paypal\./
  ];
  
  function isTestSite() {
    return testSitePatterns.some(p => p.test(config.hostname));
  }
  
  function isSensitiveDomain() {
    return sensitiveDomainsPatterns.some(p => p.test(config.hostname));
  }
  
  function isGoogleSearch() {
    return /^(www\.)?google\.(com|[a-z]{2,3})$/.test(config.hostname);
  }
  
  function isYouTube() {
    return config.hostname.includes('youtube.com');
  }
  
  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  function initialize() {
    if (!isExtensionContextValid()) {
      console.log('[BlockForge] Extension context invalid, skipping initialization');
      return;
    }
    
    try {
      chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', hostname: config.hostname }, (response) => {
        if (chrome.runtime.lastError) {
          extensionContextValid = !!chrome.runtime?.id;
          if (extensionContextValid) startProtection();
          return;
        }
        
        if (response?.success && response.config) {
          config.enabled = response.config.enabled !== false;
          config.settings = response.config.settings || {};
          config.isWhitelisted = response.config.isWhitelisted || false;
          config.disableCosmetic = response.config.disableCosmetic || false;
        }
        startProtection();
      });
    } catch (e) {
      extensionContextValid = false;
      return;
    }
    
    chrome.runtime.onMessage.addListener(handleMessage);
  }
  
  function startProtection() {
    if (!config.enabled || config.isWhitelisted) {
      console.log('[BlockForge] Protection disabled for this site');
      document.documentElement.classList.remove('blockforge-annoyances-enabled');
      return;
    }
    
    // Toggle Annoyances Filter
    if (config.settings.blockAnnoyances) {
      document.documentElement.classList.add('blockforge-annoyances-enabled');
    } else {
      document.documentElement.classList.remove('blockforge-annoyances-enabled');
    }
    
    // Inject fingerprint protection via background (MAIN world, CSP-safe)
    injectProtectionScript();
    
    // Inject CSS cosmetic filters immediately (pre-render hiding)
    if (!config.disableCosmetic) {
      injectCosmeticStyles();
    } else {
      console.log('[BlockForge] Generic cosmetic filtering disabled by $ghide exception');
    }
    
    // YouTube-specific ad blocker
    if (isYouTube()) {
      initYouTubeAdBlocker();
    }
    
    // DOM-based removal + mutation observer
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        removeAdElements();
        setupMutationObserver();
        analyzePageContent();
        setupClickInterceptor();
      });
    } else {
      removeAdElements();
      setupMutationObserver();
      analyzePageContent();
      setupClickInterceptor();
    }
  }
  
  // ============================================================================
  // YOUTUBE AD BLOCKER
  // ============================================================================
  
  function initYouTubeAdBlocker() {
    console.log('[BlockForge] Initializing YouTube ad blocker');
    
    let normalPlaybackRate = 1;
    let wasAdPlaying = false;
    
    const checkForAds = () => {
      try {
        if (!config.enabled || config.isWhitelisted) return;
        
        const video = document.querySelector('video.html5-main-video');
        const playerContainer = document.querySelector('.html5-video-player');
        const isAdPlaying = playerContainer?.classList.contains('ad-showing') || 
                           playerContainer?.classList.contains('ad-interrupting');
        
        if (isAdPlaying && video) {
          wasAdPlaying = true;
          
          // Click skip button
          const skipSelectors = [
            '.ytp-ad-skip-button-modern', '.ytp-ad-skip-button',
            '.ytp-skip-ad-button', 'button.ytp-ad-skip-button-container',
            '.ytp-ad-skip-button-slot button', '.videoAdUiSkipButton',
            '.ytp-ad-skip-button-slot', '.ytp-skip-ad-button-container',
            '[class*="skip"] button', 'button[class*="skip"]'
          ];
          
          for (const selector of skipSelectors) {
            const skipButton = document.querySelector(selector);
            if (skipButton && skipButton.offsetParent !== null) {
              skipButton.click();
              pageStats.elementsRemoved++;
              break;
            }
          }
          
          // Speed up ad playback
          if (video.playbackRate < 16) {
            normalPlaybackRate = 1;
            video.playbackRate = 16;
          }
          
          // Skip to end of ad
          if (video.duration && !isNaN(video.duration) && video.duration > 0 && video.duration < 300) {
            video.currentTime = video.duration - 0.1;
          }
          
          video.muted = true;
          
        } else if (wasAdPlaying && video) {
          wasAdPlaying = false;
          if (video.playbackRate !== normalPlaybackRate) {
            video.playbackRate = normalPlaybackRate;
          }
          video.muted = false;
        }
        
        // NOTE: We intentionally do NOT hide YouTube ad DOM elements.
        // YouTube's anti-adblock JS checks element visibility and reports
        // to the server, which then 403s the video stream.
        // Instead, we rely solely on video-level ad skipping above.
        
        // Handle YouTube Anti-Adblock Popups
        const antiAdblockDialogs = document.querySelectorAll('tp-yt-paper-dialog, ytd-popup-container');
        for (const dialog of antiAdblockDialogs) {
          const text = dialog.textContent || '';
          if (text.includes('Ad blockers violate') || 
              text.includes('Ad blockers are not allowed') || 
              text.includes('Video player will be blocked') ||
              text.includes('It looks like you may be using an ad blocker')) {
            
            dialog.style.display = 'none';
            document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(el => el.style.display = 'none');
            
            const ytApp = document.querySelector('ytd-app');
            if (ytApp) ytApp.style.overflow = '';
            document.body.style.overflow = '';
            
            // Unpause video if the popup paused it
            if (video && video.paused) {
              video.play().catch(() => {});
            }
            
            // Click the play button if necessary (sometimes YouTube overrides video.play())
            const playButton = document.querySelector('.ytp-play-button');
            if (playButton && playButton.getAttribute('data-title-no-tooltip') === 'Play') {
              playButton.click();
            }
          }
        }
        
      } catch (error) {
        if (error.message?.includes('Extension context invalidated')) {
          extensionContextValid = false;
        }
      }
    };
    
    const adCheckInterval = setInterval(() => {
      if (!extensionContextValid) { clearInterval(adCheckInterval); return; }
      checkForAds();
    }, 250);
    
    document.addEventListener('yt-navigate-finish', () => setTimeout(checkForAds, 500));
    document.addEventListener('yt-page-data-updated', checkForAds);
    window.addEventListener('beforeunload', () => clearInterval(adCheckInterval));
    setTimeout(checkForAds, 500);
  }
  
  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================
  
  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'CONFIGURE':
        config.enabled = message.config.enabled;
        config.settings = message.config.settings;
        config.isWhitelisted = message.config.isWhitelisted;
        if (config.enabled && !config.isWhitelisted) {
          startProtection();
        } else {
          document.documentElement.classList.remove('blockforge-annoyances-enabled');
        }
        
        // Dynamically toggle annoyances if already running
        if (config.settings.blockAnnoyances) {
          document.documentElement.classList.add('blockforge-annoyances-enabled');
        } else {
          document.documentElement.classList.remove('blockforge-annoyances-enabled');
        }
        
        sendResponse({ success: true });
        break;
      case 'UPDATE_FINGERPRINT_PROTECTION':
        if (message.enabled) injectProtectionScript();
        sendResponse({ success: true });
        break;
      case 'THREATS_DETECTED':
        handleThreatNotification(message.threats, message.score);
        sendResponse({ success: true });
        break;
      case 'ANALYZE_CONTENT':
        sendResponse(performContentAnalysis());
        break;
      case 'GET_PAGE_STATS':
        sendResponse(pageStats);
        break;
      case 'APPLY_COSMETIC_RULES':
        applyCosmeticRules(message.selectors);
        sendResponse({ success: true });
        break;
    }
    return true;
  }
  
  // ============================================================================
  // DOM MANIPULATION
  // ============================================================================
  
  function removeAdElements() {
    if (!isExtensionContextValid()) return;
    if (isTestSite() || isYouTube() || isGoogleSearch()) return;
    
    const isConservativeMode = isSensitiveDomain();
    
    try {
      // Use a targeted set of selectors for JS-based removal
      // (CSS cosmetic filters handle the broad hiding — JS removes stubborn elements)
      const jsRemovalSelectors = [
        'ins.adsbygoogle', 'amp-ad', 'amp-embed',
        '[data-ad-slot][data-ad-client]', 'div[data-ad-slot]',
        'ins[data-ad-slot]', 'ins[data-ad-client]',
        '[data-google-query-id][data-ad-slot]', '[data-ad-unit-id]',
        '.OUTBRAIN', '.outbrain-widget', '.taboola-widget',
        '[id*="taboola"]', '.rc-widget', '[id*="revcontent"]',
        '.mgbox', '[id*="mgid"]', '.zergnet', '[id*="zergnet"]',
        // Flash elements
        'object[data*=".swf"]', 'embed[src*=".swf"]',
        'object[type*="flash"]', 'embed[type*="flash"]',
        'object[type="application/x-shockwave-flash"]',
        'embed[type="application/x-shockwave-flash"]',
        'object[classid*="d27cdb6e"]'
      ];
      
      const elements = document.querySelectorAll(jsRemovalSelectors.join(', '));
      let removed = 0;
      const maxPerScan = isConservativeMode ? 50 : 200;
      let processed = 0;
      
      for (const element of elements) {
        if (processed >= maxPerScan) break;
        processed++;
        if (shouldRemoveElement(element)) {
          removeElement(element);
          removed++;
        }
      }
      
      // Scan ad images (skip on conservative mode)
      if (!isConservativeMode) removed += scanForAdImages();
      removed += scanForAdIframes();
      removed += scanForEmptyAdContainers();
      
      pageStats.elementsRemoved += removed;
      
      if (removed > 0) {
        console.log(`[BlockForge] Removed ${removed} ad elements${isConservativeMode ? ' (conservative mode)' : ''}`);
        reportBlockedElements(removed, 'ads');
      }
    } catch (error) {
      if (error.message?.includes('Extension context invalidated')) {
        extensionContextValid = false;
        return;
      }
      console.error('[BlockForge] Error removing ads:', error);
    }
  }
  
  function scanForAdImages() {
    let removed = 0;
    const images = document.querySelectorAll('img');
    
    images.forEach(img => {
      const width = img.width || img.naturalWidth || parseInt(img.getAttribute('width')) || 0;
      const height = img.height || img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
      const src = (img.src || img.getAttribute('data-src') || '').toLowerCase();
      const alt = (img.alt || '').toLowerCase();
      
      // Check src for ad keywords
      let hasAdKeyword = false;
      for (const keyword of AD_KEYWORDS) {
        if (keyword === 'ad' || keyword === 'ads') {
          // Require delimiters for short, common generic words
          if (src.includes(`/${keyword}/`) || src.includes(`_${keyword}_`) || 
              src.includes(`-${keyword}-`) || src.includes(`.${keyword}`) || 
              src.includes(`${keyword}.`) || src.includes(`?${keyword}=`) ||
              src.includes(`&${keyword}=`)) {
            hasAdKeyword = true;
            break;
          }
        } else {
          if (src.includes(keyword)) {
            hasAdKeyword = true;
            break;
          }
        }
      }
      
      if (hasAdKeyword) { removeElement(img); removed++; return; }
      
      // Check if ad-sized with ad context
      let isAdSize = AD_SIZES.some(([w, h]) => Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5);
      
      if (isAdSize) {
        let parent = img.parentElement;
        let depth = 0;
        while (parent && depth < 5) {
          const cls = (parent.className || '').toString().toLowerCase();
          const pid = (parent.id || '').toLowerCase();
          if (cls.includes('ad') || pid.includes('ad') ||
              cls.includes('banner') || cls.includes('sponsor') || cls.includes('promo')) {
            removeElement(img); removed++; return;
          }
          parent = parent.parentElement;
          depth++;
        }
        
        const anchor = img.closest('a');
        if (anchor) {
          const href = (anchor.href || '').toLowerCase();
          for (const kw of ['click', 'track', 'ad', 'sponsor', 'affiliate', 'promo']) {
            if (href.includes(kw)) { removeElement(img); removed++; return; }
          }
        }
      }
      
      if (alt.includes('advertisement') || alt.includes('sponsored') || 
          alt.includes('promoted') || alt.includes('ad ')) {
        removeElement(img); removed++;
      }
    });
    
    return removed;
  }
  
  function scanForAdIframes() {
    let removed = 0;
    const iframes = document.querySelectorAll('iframe');
    const adPatterns = [
      'ad', 'ads', 'advert', 'banner', 'sponsor', 'promo', 'doubleclick',
      'googlesyndication', 'googleadservices', 'adserver', 'adnetwork',
      'outbrain', 'taboola', 'revcontent', 'mgid', 'pubads', 'pagead',
      'aswift', 'googleads', 'adsense', 'adform', 'openx', 'criteo'
    ];
    
    iframes.forEach(iframe => {
      const width = parseInt(iframe.width) || iframe.offsetWidth || parseInt(iframe.style.width) || 0;
      const height = parseInt(iframe.height) || iframe.offsetHeight || parseInt(iframe.style.height) || 0;
      const src = (iframe.src || '').toLowerCase();
      const name = (iframe.name || '').toLowerCase();
      const id = (iframe.id || '').toLowerCase();
      const className = (iframe.className || '').toLowerCase();
      
      // Check ad patterns in attributes
      for (const pattern of adPatterns) {
        if (pattern === 'ad' || pattern === 'ads') {
          // Use boundary matching for short generic words
          const regex = new RegExp(`(^|[-_./&? ])${pattern}([-_./&? ]|$)`, 'i');
          if (regex.test(src) || regex.test(name) || regex.test(id) || regex.test(className)) {
            removeElement(iframe); removed++; return;
          }
        } else {
          if (src.includes(pattern) || name.includes(pattern) || 
              id.includes(pattern) || className.includes(pattern)) {
            removeElement(iframe); removed++; return;
          }
        }
      }
      
      // Check data attributes
      for (const attr of iframe.attributes) {
        if (attr.name.startsWith('data-') && 
            adPatterns.some(p => attr.value.toLowerCase().includes(p))) {
          removeElement(iframe); removed++; return;
        }
      }
      
      // Check ad-sized iframes with ad-context parents
      for (const [w, h] of AD_SIZES) {
        if (Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5) {
          let parent = iframe.parentElement;
          let depth = 0;
          while (parent && depth < 4) {
            const cls = (parent.className || '').toString().toLowerCase();
            const pid = (parent.id || '').toLowerCase();
            if (cls.includes('ad') || pid.includes('ad') ||
                cls.includes('banner') || cls.includes('sponsor') ||
                cls.includes('gpt-') || cls.includes('dfp-')) {
              removeElement(iframe); removed++; return;
            }
            parent = parent.parentElement;
            depth++;
          }
          
          if (!src || src === 'about:blank' || src.startsWith('javascript:')) {
            const parentDiv = iframe.closest('div');
            if (parentDiv) {
              const divClass = (parentDiv.className || '').toLowerCase();
              const divId = (parentDiv.id || '').toLowerCase();
              if (divClass.includes('ad') || divId.includes('ad') || 
                  divClass.includes('slot') || divClass.includes('banner')) {
                removeElement(iframe); removed++; return;
              }
            }
          }
          break;
        }
      }
    });
    
    return removed;
  }
  
  function scanForEmptyAdContainers() {
    let removed = 0;
    const potentialAdDivs = document.querySelectorAll(
      'div[class*="-ad-"], div[class^="ad-"], div[class$="-ad"], div.ad, ' +
      'div[id*="-ad-"], div[id^="ad-"], div[id$="-ad"], div#ad, ' +
      'div[class*="banner"], div[class*="sponsor"],' +
      'div[data-ad], div[data-ad-slot], div[data-google-query-id], ins.adsbygoogle'
    );
    
    potentialAdDivs.forEach(div => {
      const text = (div.textContent || '').trim();
      const hasVisibleChildren = div.querySelector('img, video, iframe, canvas, svg, object, embed');
      
      if (!text && !hasVisibleChildren) {
        div.style.display = 'none';
        removed++;
      } else if (div.offsetHeight === 0 || div.offsetWidth === 0) {
        div.style.display = 'none';
        removed++;
      }
    });
    
    return removed;
  }
  
  // ============================================================================
  // ELEMENT SAFETY CHECKS
  // ============================================================================
  
  function shouldRemoveElement(element) {
    if (!element || !element.tagName) return false;
    
    const tag = element.tagName.toLowerCase();
    
    const protectedTags = [
      'html', 'body', 'head', 'main', 'article', 'section', 'nav', 
      'header', 'footer', 'form', 'input', 'textarea', 'select', 
      'button', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'video', 'audio', 'canvas',
      'svg', 'picture', 'figure', 'figcaption', 'details', 'summary',
      'dialog', 'menu', 'menuitem', 'template', 'slot'
    ];
    if (protectedTags.includes(tag)) return false;
    
    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return false;
    
    const role = (element.getAttribute('role') || '').toLowerCase();
    const protectedRoles = [
      'main', 'navigation', 'banner', 'contentinfo', 'complementary',
      'form', 'search', 'application', 'document', 'feed', 'log',
      'region', 'status', 'tabpanel', 'toolbar', 'dialog', 'alertdialog',
      'menu', 'menubar', 'tree', 'treegrid', 'grid', 'listbox'
    ];
    if (protectedRoles.includes(role)) return false;
    
    // Don't remove if it takes up significant viewport
    try {
      const rect = element.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.width > vw * 0.6 && rect.height > vh * 0.6) return false;
    } catch (e) {}
    
    // Preserve elements with lots of non-ad text
    const text = (element.textContent || '').trim();
    if (text.length > 500) {
      const adMentions = ['sponsor', 'advert', 'promoted', 'paid content', 'partner content'];
      if (!adMentions.some(term => text.toLowerCase().includes(term))) return false;
    }
    
    // Don't remove interactive elements
    if (element.querySelector('input, textarea, select, button, [contenteditable="true"], video, audio')) {
      return false;
    }
    
    // Always remove tracking pixels
    if (tag === 'img') {
      const w = element.width || element.naturalWidth || parseInt(element.style.width) || 0;
      const h = element.height || element.naturalHeight || parseInt(element.style.height) || 0;
      if (w <= 1 && h <= 1) return true;
    }
    
    // Check false positive indicators
    const className = (element.className || '').toString().toLowerCase();
    const id = (element.id || '').toLowerCase();
    
    const falsePositivePatterns = [
      'loading', 'loader', 'spinner', 'skeleton',
      'header', 'footer', 'navigation', 'sidebar', 'content',
      'article', 'post', 'comment', 'reply', 'message',
      'product', 'item', 'card', 'tile', 'grid',
      'modal', 'dialog', 'popup', 'tooltip', 'dropdown',
      'accordion', 'tab', 'panel', 'collapse',
      'search', 'filter', 'sort', 'pagination',
      'user', 'profile', 'avatar', 'author',
      'date', 'time', 'meta', 'info', 'detail',
      'social', 'share', 'like', 'follow',
      'notification', 'alert', 'warning', 'error', 'success'
    ];
    
    let hasOnlyFalsePositivePatterns = false;
    for (const pattern of falsePositivePatterns) {
      if ((className.includes(pattern) || id.includes(pattern)) &&
          !className.includes('ad') && !id.includes('ad') &&
          !className.includes('sponsor') && !id.includes('sponsor') &&
          !className.includes('banner') && !id.includes('banner')) {
        hasOnlyFalsePositivePatterns = true;
        break;
      }
    }
    
    if (hasOnlyFalsePositivePatterns) {
      const clearAdIndicators = ['adsense', 'adsbygoogle', 'googlesyndication', 'doubleclick', 
                                  'taboola', 'outbrain', 'revcontent', 'mgid'];
      if (!clearAdIndicators.some(ind => className.includes(ind) || id.includes(ind))) {
        return false;
      }
    }
    
    return true;
  }

  function removeElement(element) {
    if (!element) return;
    try {
      if (!document.contains(element)) return;
      if (element.parentNode) element.parentNode.removeChild(element);
    } catch (e) {
      try {
        element.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; position: absolute !important; left: -9999px !important;';
        pageStats.elementsHidden++;
      } catch (e2) {}
    }
  }
  
  function applyCosmeticRules(selectors) {
    if (!selectors || selectors.length === 0) return;
    let styleElement = document.getElementById('blockforge-cosmetic');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'blockforge-cosmetic';
      styleElement.type = 'text/css';
      (document.head || document.documentElement).appendChild(styleElement);
    }
    styleElement.textContent = selectors.map(s => `${s} { display: none !important; visibility: hidden !important; }`).join('\n');
  }
  
  // ============================================================================
  // MUTATION OBSERVER
  // ============================================================================
  
  function setupMutationObserver() {
    if (isTestSite() || isYouTube()) return;
    
    const observer = new MutationObserver((mutations) => {
      if (!extensionContextValid) { observer.disconnect(); return; }
      
      let shouldScan = false;
      
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Immediate Flash blocking
              const tag = node.tagName?.toLowerCase();
              if (tag === 'object' || tag === 'embed') {
                const data = (node.getAttribute('data') || '').toLowerCase();
                const src = (node.getAttribute('src') || '').toLowerCase();
                const type = (node.getAttribute('type') || '').toLowerCase();
                if (data.includes('.swf') || src.includes('.swf') ||
                    type.includes('flash') || type.includes('shockwave') ||
                    data.includes('flash') || src.includes('flash')) {
                  node.remove();
                  pageStats.elementsRemoved++;
                  continue;
                }
              }
              
              // Check for nested Flash elements
              if (node.querySelectorAll) {
                node.querySelectorAll(
                  'object[data*=".swf"], embed[src*=".swf"], object[type*="flash"], embed[type*="flash"]'
                ).forEach(el => { el.remove(); pageStats.elementsRemoved++; });
              }
              
              shouldScan = true;
              
              // Immediate ad element check
              if (isAdElement(node)) {
                removeElement(node);
                pageStats.elementsRemoved++;
              }
            }
          }
        }
        
        // Flash attribute changes
        if (mutation.type === 'attributes' && mutation.target) {
          const target = mutation.target;
          const tag = target.tagName?.toLowerCase();
          if (tag === 'object' || tag === 'embed') {
            const data = (target.getAttribute('data') || '').toLowerCase();
            const src = (target.getAttribute('src') || '').toLowerCase();
            const type = (target.getAttribute('type') || '').toLowerCase();
            if (data.includes('.swf') || src.includes('.swf') ||
                type.includes('flash') || type.includes('shockwave')) {
              target.remove();
              pageStats.elementsRemoved++;
            }
          }
        }
      }
      
      if (shouldScan) debouncedScan();
    });
    
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data', 'src', 'type']
    });
  }
  
  function isAdElement(element) {
    if (!element || !element.tagName) return false;
    
    const tag = element.tagName.toLowerCase();
    const classNames = (element.className || '').toString().toLowerCase();
    const id = (element.id || '').toLowerCase();
    const src = (element.src || '').toString().toLowerCase();
    
    // Check class/id patterns
    const adPatterns = [
      'ad-', 'ads-', 'advert', 'sponsor', 'promoted', 'banner-ad',
      'bannerad', 'ad_', 'adbox', 'adunit', 'adspace', 'adslot',
      'leaderboard', 'skyscraper', 'rectangle-ad', 'mpu'
    ];
    
    for (const pattern of adPatterns) {
      if (classNames.includes(pattern) || id.includes(pattern)) return true;
    }
    
    // Check iframe sources
    if (tag === 'iframe') {
      const iframeSrc = element.src?.toLowerCase() || '';
      const iframeName = (element.name || '').toLowerCase();
      if (iframeSrc.includes('doubleclick') || iframeSrc.includes('googlesyndication') || 
          iframeSrc.includes('adservice') || iframeSrc.includes('advertising') ||
          iframeSrc.includes('/ads/') || iframeSrc.includes('/ad/') ||
          iframeSrc.includes('banner') || iframeName.includes('google_ads')) {
        return true;
      }
      
      const width = parseInt(element.width) || element.offsetWidth || 0;
      const height = parseInt(element.height) || element.offsetHeight || 0;
      if (AD_SIZES.some(([w, h]) => (width === w && height === h) || 
          (Math.abs(width - w) <= 5 && Math.abs(height - h) <= 5))) {
        return true;
      }
    }
    
    if (tag === 'ins' && classNames.includes('adsbygoogle')) return true;
    
    // Flash ads
    if (tag === 'object' || tag === 'embed') {
      const data = element.data?.toLowerCase() || element.src?.toLowerCase() || '';
      const type = (element.type || '').toLowerCase();
      if (data.includes('.swf') || type.includes('flash') || data.includes('flash')) return true;
    }
    
    // Tracking pixels
    if (tag === 'img') {
      const w = element.width || element.naturalWidth || parseInt(element.style.width) || 0;
      const h = element.height || element.naturalHeight || parseInt(element.style.height) || 0;
      if (w <= 1 && h <= 1) return true;
      if (src.includes('/ads/') || src.includes('/ad/') || src.includes('banner') || 
          src.includes('sponsor') || src.includes('advert')) return true;
      
      const parent = element.parentElement;
      if (parent && parent.tagName === 'A') {
        const parentHref = (typeof parent.href === 'string' ? parent.href : parent.href?.baseVal || '').toLowerCase();
        if (parentHref.includes('doubleclick') || parentHref.includes('/ads/') ||
            parentHref.includes('click.') || parentHref.includes('adserver')) return true;
      }
    }
    
    if (element.hasAttribute('data-ad') || element.hasAttribute('data-ad-slot') ||
        element.hasAttribute('data-ad-client') || element.hasAttribute('data-google-query-id')) {
      return true;
    }
    
    return false;
  }
  
  // Debounced scan with rate limiting
  let scanTimeout = null;
  let lastScanTime = 0;
  let scanCount = 0;
  const SCAN_COOLDOWN = 100;
  const MAX_SCANS_PER_SECOND = 5;
  
  function debouncedScan() {
    if (!isExtensionContextValid()) return;
    
    const now = Date.now();
    if (now - lastScanTime > 1000) scanCount = 0;
    if (scanCount >= MAX_SCANS_PER_SECOND) return;
    
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      if (!extensionContextValid) return;
      try {
        if (scanCount < MAX_SCANS_PER_SECOND) {
          removeAdElements();
          lastScanTime = Date.now();
          scanCount++;
        }
      } catch (error) {
        if (error.message?.includes('Extension context invalidated')) {
          extensionContextValid = false;
        }
      }
    }, SCAN_COOLDOWN);
  }
  
  // ============================================================================
  // COSMETIC STYLE INJECTION
  // ============================================================================
  
  function injectCosmeticStyles() {
    // Skip CSS injection for Google Search — rely only on network blocking
    if (isGoogleSearch()) return;
    
    const style = document.createElement('style');
    style.id = 'blockforge-cosmetic-block';
    style.type = 'text/css';
    
    if (isTestSite()) {
      style.textContent = `
        /* Minimal: only block actual ad network content on test sites */
        ins.adsbygoogle,
        iframe[src*="doubleclick"],
        iframe[src*="googlesyndication"],
        iframe[src*="googleadservices"],
        [id*="google_ads"], [id*="aswift"],
        .OUTBRAIN, .outbrain-widget,
        .taboola-widget,
        object[data*=".swf"], embed[src*=".swf"],
        object[type*="flash"], embed[type*="flash"],
        object[type="application/x-shockwave-flash"],
        embed[type="application/x-shockwave-flash"],
        object[classid*="d27cdb6e"] {
          display: none !important;
          visibility: hidden !important;
        }
      `;
    } else if (isYouTube()) {
      // NO cosmetic CSS for YouTube!
      // YouTube's anti-adblock JS checks element visibility.
      // Hiding elements triggers server-side 403 on the video stream.
      // We rely solely on the video-level auto-skipper in initYouTubeAdBlocker().
      return;
    } else {
      // Full cosmetic blocking for normal sites
      style.textContent = `
        /* Generic ad containers */
        [class*="ad-container"], [class*="ad-wrapper"], [class*="ad-banner"],
        [class*="ad-slot"], [class*="ad-unit"], [class*="advert"],
        [class*="advertisement"], [class*="sponsored"], [class*="banner-ad"],
        [class*="bannerAd"], [class*="leaderboard"], [class*="skyscraper"],
        [class*="native-ad"], [class*="nativead"], [class*="promo-"],
        [class*="dfp-"], [class*="gpt-ad"], [class*="outbrain"],
        [class*="taboola"], [class*="revcontent"], [class*="mgid"],
        [class*="content-ad"], [class*="contentad"],
        [id*="ad-container"], [id*="ad-wrapper"], [id*="ad-banner"],
        [id*="google_ads"], [id*="GoogleAds"], [id*="banner-ad"],
        [id*="dfp-"], [id*="gpt-ad"], [id*="div-gpt-ad"],
        .ad, .ads, .adv, .adbox, .ad-box, .adunit, .ad_unit, .ad-unit,
        .adsbox, .adSpace, .ad-space, .adContainer,
        .adwrapper, .adframe, .adfill, .adslot, .adzone, .adplaceholder,
        .ad-placeholder, .adarea, .ad-area, .adspot, .ad-spot,
        #ad, #ads, #adv, #adbox, #advertisement, #adContainer,
        #adWrapper, #adFrame, #adUnit, #adSlot, #adZone,
        ins.adsbygoogle, amp-ad, amp-embed,
        [data-ad], [data-ad-slot], [data-ad-client], [data-google-query-id],
        .OUTBRAIN, .outbrain-widget, [data-widget-id*="outbrain"],
        .taboola-widget, [id*="taboola"], .rc-widget, [id*="revcontent"],
        .mgbox, [id*="mgid"], .zergnet, [id*="zergnet"] {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
          max-height: 0 !important;
          max-width: 0 !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          position: absolute !important;
          left: -9999px !important;
        }
        
        /* Flash/SWF objects */
        object[data*=".swf"], embed[src*=".swf"],
        object[type*="flash"], embed[type*="flash"],
        object[type="application/x-shockwave-flash"],
        embed[type="application/x-shockwave-flash"],
        object[classid*="d27cdb6e"] {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
        }
        
        /* Ad iframes */
        iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
        iframe[src*="googleadservices"], iframe[src*="adservice"],
        iframe[src*="/ads/"], iframe[src*="/ad/"],
        iframe[src*="banner"], iframe[src*="sponsor"],
        iframe[src*="adserver"], iframe[src*="adnetwork"],
        iframe[src*="outbrain"], iframe[src*="taboola"],
        iframe[src*="revcontent"], iframe[src*="mgid"],
        iframe[name*="google_ads"], iframe[id*="google_ads"],
        iframe[id*="aswift"] {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
        }
        
        /* Common ad size iframes */
        iframe[width="728"][height="90"], iframe[width="300"][height="250"],
        iframe[width="336"][height="280"], iframe[width="160"][height="600"],
        iframe[width="468"][height="60"], iframe[width="970"][height="90"],
        iframe[width="970"][height="250"], iframe[width="300"][height="600"],
        iframe[width="320"][height="50"], iframe[width="320"][height="100"] {
          display: none !important;
          visibility: hidden !important;
        }
        
        /* Ad images by URL patterns */
        img[src*="/ads/"], img[src*="/ad/"],
        img[src*="banner"], img[src*="sponsor"],
        img[src*="advert"], img[src*="promo"],
        img[src*="728x90"], img[src*="300x250"],
        img[src*="160x600"], img[src*="320x50"],
        a[href*="/ads/"] img, a[href*="doubleclick"] img,
        a[href*="click."] img, a[href*="affiliate"] img {
          display: none !important;
          visibility: hidden !important;
        }
        
        /* Tracking pixels */
        img[width="1"][height="1"], img[width="0"][height="0"],
        img[style*="width: 1px"][style*="height: 1px"],
        img[style*="width:1px"][style*="height:1px"] {
          display: none !important;
        }
        
        /* Empty ad containers */
        div:empty[class*="ad"], div:empty[id*="ad"],
        div:empty[data-ad], ins:empty.adsbygoogle {
          display: none !important;
        }
        
        /* Common ad labels */
        [aria-label*="advertisement"], [aria-label*="Advertisement"],
        [aria-label*="Sponsored"], [aria-label*="sponsored"],
        [aria-label*="Promoted"] {
          display: none !important;
        }
        
        /* AdBlock tester cosmetic selectors */
        .ad-test, .ad_test, .adtest, #ad-test, #ad_test, #adtest,
        .adstest, .ads-test, #adstest, #ads-test,
        .pub_300x250, .pub_300x250m, .pub_728x90,
        .textad, .textAd, .text-ad, .text_ad,
        .sponsortext, .sponsor-text, .sponsored-text,
        .adBanner, .ad-Banner, .ad_Banner, .adbanner,
        .bannerAd, .banner-Ad, .banner_Ad, .bannerad,
        #adBanner, #ad-Banner, #ad_Banner, #adbanner,
        #bannerAd, #banner-Ad, #banner_Ad, #bannerad,
        .adblock-test, .adblock_test, .adblocktest,
        #adblock-test, #adblock_test, #adblocktest,
        .banner_ad, .banner-ad, .bannerad_wrapper,
        .adsense, .ad-sense, .ad_sense,
        #adsense, #ad-sense, #ad_sense,
        .adHeader, .adFooter, .adSidebar, .adContent,
        #adHeader, #adFooter, #adSidebar, #adContent,
        .ad-header, .ad-footer, .ad-sidebar, .ad-content,
        .GoogleAd, .googleAd, .google-ad, .google_ad,
        #GoogleAd, #googleAd, #google-ad, #google_ad,
        #ADSLOT_1,
        .adwords, .ad-words, .ad_words, .AdWords,
        .sidebar-ad, .sidebar_ad, .sidebarad,
        .footer-ad, .footer_ad, .footerad,
        .header-ad, .header_ad, .headerad,
        .rightAd, .right-ad, .right_ad, .rightad,
        .leftAd, .left-ad, .left_ad, .leftad,
        .topAd, .top-ad, .top_ad, .topad,
        .bottomAd, .bottom-ad, .bottom_ad, .bottomad,
        .widgetAd, .widget-ad, .widget_ad,
        .adWidget, .ad-widget, .ad_widget,
        .module-ad, .module_ad, .modulead,
        .ad-module, .ad_module, .admodule,
        .contentAd, .content-ad, .content_ad,
        .page-ad, .page_ad, .pagead,
        .ad-frame, .ad_frame, .adframe,
        .ad-label, .ad_label, .adlabel,
        .adtag, .ad-tag, .ad_tag,
        
        /* Programmatic & Native Ad Networks */
        .trc_related_container, .trc_rbox_container, [id^="taboola-"],
        .OUTBRAIN, .ob-widget, .ob-smartfeed, [id^="outbrain_widget"],
        [id^="criteo-"], .criteo-widget,
        .rc-widget, [id^="revcontent-"],
        .nativo-widget, .ntv-ad, [id^="nativo-"],
        .admob-ad, [id^="admob-"],
        
        div[style*="width: 300px"][style*="height: 250px"],
        div[style*="width: 728px"][style*="height: 90px"],
        div[style*="width: 160px"][style*="height: 600px"],
        div[style*="width: 320px"][style*="height: 50px"] {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          width: 0 !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
    }
    
    // Insert at the very beginning for pre-render hiding
    if (document.head) {
      document.head.insertBefore(style, document.head.firstChild);
    } else if (document.documentElement) {
      document.documentElement.insertBefore(style, document.documentElement.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.head || document.documentElement).insertBefore(style, 
          (document.head || document.documentElement).firstChild);
      });
    }
    
    console.log('[BlockForge] Cosmetic styles injected');
  }
  
  // ============================================================================
  // SCRIPT INJECTION (via background service worker for CSP bypass)
  // ============================================================================
  
  function injectProtectionScript() {
    if (!isExtensionContextValid()) return;
    // Skip on YouTube — blob URL injection triggers CSP violations
    // that YouTube's anti-adblock detection picks up
    if (isYouTube()) return;
    
    try {
      chrome.runtime.sendMessage({ type: 'INJECT_PROTECTION_SCRIPT' }, (response) => {
        if (chrome.runtime.lastError) {
          extensionContextValid = !!chrome.runtime?.id;
          return;
        }
        if (response?.success) {
          console.log('[BlockForge] Protection script injected successfully');
        }
        if (response && !response.success) {
          if (response.error && (response.error.includes('restricted') || response.error.includes('chrome://'))) return;
          console.warn('[BlockForge] Protection script injection failed:', response.error);
        }
      });
    } catch (error) {
      extensionContextValid = false;
    }
  }
  
  // ============================================================================
  // CLICK INTERCEPTOR (Popunder/Clickjacking Blocker)
  // ============================================================================
  
  function setupClickInterceptor() {
    if (!config.settings.blockAnnoyances) return;
    
    document.addEventListener('click', (e) => {
      const el = e.target;
      const tagName = el.tagName;
      if (tagName === 'DIV' || tagName === 'A' || tagName === 'SPAN' || tagName === 'IFRAME' || tagName === 'OBJECT' || tagName === 'EMBED') {
        try {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          
          // Detect if element is covering a massive portion of the screen
          const isCoveringScreen = rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;
          
          // Detect if it is invisible or acting as a high z-index overlay trap
          const isAbsoluteOrFixed = style.position === 'absolute' || style.position === 'fixed';
          const isHighZIndex = parseInt(style.zIndex, 10) > 9000;
          const isZeroOpacity = style.opacity === '0';
          const isTransparent = style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent';
          
          // Traps must be floating (absolute/fixed/high z-index) AND invisible
          const isInvisibleOverlay = isZeroOpacity || (isTransparent && (isAbsoluteOrFixed || isHighZIndex));
          
          if (isCoveringScreen && isInvisibleOverlay) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[BlockForge] Intercepted click on invisible overlay/popunder. Destroying trap.');
            el.remove();
            return false; // Prevent default action
          }
        } catch (err) {
          // Ignore style errors
        }
      }
    }, true); // Use capture phase to intercept BEFORE the site's own listeners
  }

  // ============================================================================
  // CONTENT ANALYSIS
  // ============================================================================
  
  function analyzePageContent() {
    const analysis = performContentAnalysis();
    if (analysis.threats.length > 0) {
      pageStats.threats = analysis.threats;
    }
  }
  
  function performContentAnalysis() {
    const threats = [];
    let score = 0;
    
    // Analyze external scripts
    const scripts = document.querySelectorAll('script[src]');
    for (const script of scripts) {
      const src = script.src || '';
      for (const pattern of trackingScriptPatterns) {
        if (pattern.test(src)) {
          threats.push({ type: 'tracking_script', severity: 'medium', url: src });
          score += 10;
          break;
        }
      }
    }
    
    // Check inline scripts for fingerprinting
    const inlineScripts = document.querySelectorAll('script:not([src])');
    for (const script of inlineScripts) {
      const content = script.textContent || '';
      let hits = 0;
      for (const pattern of fingerprintPatterns) {
        if (content.includes(pattern)) hits++;
      }
      if (hits >= 3) {
        threats.push({ type: 'fingerprinting', severity: 'high', details: `${hits} fingerprinting APIs detected` });
        score += 30;
      }
    }
    
    // Check for tracking pixels
    for (const img of document.querySelectorAll('img[src]')) {
      if ((img.width <= 1 || img.naturalWidth <= 1) && (img.height <= 1 || img.naturalHeight <= 1)) {
        const src = img.src || '';
        if (src.includes('track') || src.includes('pixel') || src.includes('beacon')) {
          threats.push({ type: 'tracking_pixel', severity: 'low', url: src });
          score += 5;
        }
      }
    }
    
    // Check third-party iframes
    const pageHost = window.location.hostname;
    for (const iframe of document.querySelectorAll('iframe[src]')) {
      try {
        const iframeHost = new URL(iframe.src).hostname;
        if (iframeHost !== pageHost && !iframeHost.endsWith('.' + pageHost)) {
          if (iframe.src.includes('ad') || iframe.src.includes('track')) {
            threats.push({ type: 'third_party_iframe', severity: 'medium', url: iframe.src });
            score += 15;
          }
        }
      } catch (e) {}
    }
    
    return {
      threats,
      score: Math.min(100, score),
      elementsAnalyzed: scripts.length + inlineScripts.length + document.querySelectorAll('img[src]').length + document.querySelectorAll('iframe[src]').length
    };
  }
  
  function handleThreatNotification(threats, score) {
    if (threats.length === 0) return;
    pageStats.threats = [...pageStats.threats, ...threats];
    if (score >= 70) console.warn('[BlockForge] High threat score:', score, threats);
  }
  
  // ============================================================================
  // REPORTING
  // ============================================================================
  
  function reportBlockedElements(count, category) {
    if (!isExtensionContextValid()) return;
    try {
      chrome.runtime.sendMessage({ type: 'REPORT_DOM_BLOCKED', count, category }).catch(() => {
        extensionContextValid = false;
      });
    } catch (e) {
      extensionContextValid = false;
    }
  }
  
  // ============================================================================
  // START
  // ============================================================================
  
  initialize();
  
})();
