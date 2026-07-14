/**
 * BlockForge - Element Zapper
 * Allows users to manually block any element on the page
 */

(function() {
  'use strict';
  
  if (window.__blockforge_zapper_loaded__) return;
  window.__blockforge_zapper_loaded__ = true;
  
  const hostname = window.location.hostname;
  const storageKey = `zapper_${hostname}`;
  let zapperActive = false;
  let hoveredElement = null;
  let customStyleElement = null;
  
  // ==========================================
  // INITIALIZATION & CSS INJECTION
  // ==========================================
  
  async function loadAndInjectZapperCSS() {
    try {
      const data = await chrome.storage.local.get([storageKey]);
      const selectors = data[storageKey] || [];
      
      if (selectors.length > 0) {
        injectCustomCSS(selectors);
      }
    } catch (e) {
      console.error('[BlockForge Zapper] Error loading custom rules:', e);
    }
  }
  
  function injectCustomCSS(selectors) {
    if (!customStyleElement) {
      customStyleElement = document.createElement('style');
      customStyleElement.id = 'blockforge-zapper-css';
      // Use document.documentElement as fallback if head doesn't exist yet
      (document.head || document.documentElement).appendChild(customStyleElement);
    }
    
    // Create a CSS rule that hides all selectors
    if (selectors.length > 0) {
      const cssString = selectors.join(',\n') + ' { display: none !important; }';
      customStyleElement.textContent = cssString;
    } else {
      customStyleElement.textContent = '';
    }
  }
  
  // Load initially
  loadAndInjectZapperCSS();
  
  // ==========================================
  // ZAPPER MODE LOGIC
  // ==========================================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ACTIVATE_ZAPPER') {
      activateZapper();
      sendResponse({ success: true });
    } else if (message.type === 'CLEAR_ZAPPER') {
      clearZapperRules();
      sendResponse({ success: true });
    }
  });
  
  function activateZapper() {
    if (zapperActive) return;
    zapperActive = true;
    
    document.addEventListener('mouseover', handleMouseOver, { capture: true, passive: false });
    document.addEventListener('mouseout', handleMouseOut, { capture: true, passive: false });
    document.addEventListener('click', handleClick, { capture: true, passive: false });
    document.addEventListener('keydown', handleKeyDown, { capture: true, passive: false });
    
    console.log('[BlockForge Zapper] Zapper mode activated. Click an element to block it. Press ESC to cancel.');
  }
  
  function deactivateZapper() {
    if (!zapperActive) return;
    zapperActive = false;
    
    if (hoveredElement) {
      hoveredElement.classList.remove('blockforge-zapper-highlight');
      hoveredElement = null;
    }
    
    document.removeEventListener('mouseover', handleMouseOver, { capture: true });
    document.removeEventListener('mouseout', handleMouseOut, { capture: true });
    document.removeEventListener('click', handleClick, { capture: true });
    document.removeEventListener('keydown', handleKeyDown, { capture: true });
    
    console.log('[BlockForge Zapper] Zapper mode deactivated.');
  }
  
  function handleMouseOver(e) {
    if (!zapperActive) return;
    
    // Prevent highlight on the body or html itself to avoid freezing the page visually
    if (e.target === document.body || e.target === document.documentElement) return;
    
    if (hoveredElement) {
      hoveredElement.classList.remove('blockforge-zapper-highlight');
    }
    
    hoveredElement = e.target;
    hoveredElement.classList.add('blockforge-zapper-highlight');
  }
  
  function handleMouseOut(e) {
    if (!zapperActive) return;
    
    if (hoveredElement) {
      hoveredElement.classList.remove('blockforge-zapper-highlight');
      hoveredElement = null;
    }
  }
  
  async function handleClick(e) {
    if (!zapperActive) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.target;
    if (target) {
      target.classList.remove('blockforge-zapper-highlight');
      
      const selector = generateSelector(target);
      if (selector) {
        await saveSelector(selector);
      }
    }
    
    deactivateZapper();
  }
  
  function handleKeyDown(e) {
    if (zapperActive && e.key === 'Escape') {
      deactivateZapper();
    }
  }
  
  // ==========================================
  // SELECTOR GENERATION
  // ==========================================
  
  function generateSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    
    // 1. If it has an ID, that's best
    if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) {
      return '#' + el.id;
    }
    
    const path = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      
      // Stop at body
      if (selector === 'body' || selector === 'html') {
        path.unshift(selector);
        break;
      }
      
      if (current.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(current.id)) {
        selector += '#' + current.id;
        path.unshift(selector);
        break; // IDs are unique enough, we can stop going up
      } else {
        let hasValidClass = false;
        
        // Try classes
        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(c => {
            return c && !c.includes('blockforge') && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c);
          });
          
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
            hasValidClass = true;
          }
        }
        
        // If no class or ID, use nth-child to ensure uniqueness
        if (!hasValidClass) {
          let sibling = current;
          let nth = 1;
          while (sibling = sibling.previousElementSibling) {
            nth++;
          }
          selector += `:nth-child(${nth})`;
        }
      }
      
      path.unshift(selector);
      current = current.parentElement;
    }
    
    return path.join(' > ');
  }
  
  async function saveSelector(selector) {
    try {
      const data = await chrome.storage.local.get([storageKey]);
      const selectors = data[storageKey] || [];
      
      if (!selectors.includes(selector)) {
        selectors.push(selector);
        await chrome.storage.local.set({ [storageKey]: selectors });
        
        // Immediately apply
        injectCustomCSS(selectors);
        console.log(`[BlockForge Zapper] Saved and applied selector: ${selector}`);
      }
    } catch (e) {
      console.error('[BlockForge Zapper] Error saving selector:', e);
    }
  }
  
  async function clearZapperRules() {
    try {
      await chrome.storage.local.remove([storageKey]);
      injectCustomCSS([]);
      console.log('[BlockForge Zapper] Cleared zapper rules for this site.');
    } catch (e) {
      console.error('[BlockForge Zapper] Error clearing rules:', e);
    }
  }

})();
