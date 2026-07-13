// YouTube Anti-Adblock & Ad Data interceptor (Synchronous MAIN world injection)
(function() {
  if (window.__blockforge_yt_bypassed__) return;
  window.__blockforge_yt_bypassed__ = true;
  
  const originalParse = JSON.parse;
  JSON.parse = function() {
    const parsed = originalParse.apply(this, arguments);
    if (parsed && typeof parsed === 'object') {
      if (parsed.playerAds) delete parsed.playerAds;
      if (parsed.adPlacements) delete parsed.adPlacements;
      if (parsed.adSlots) delete parsed.adSlots;
    }
    return parsed;
  };
  
  if (window.ytInitialPlayerResponse) {
    delete window.ytInitialPlayerResponse.playerAds;
    delete window.ytInitialPlayerResponse.adPlacements;
    delete window.ytInitialPlayerResponse.adSlots;
  }
})();
