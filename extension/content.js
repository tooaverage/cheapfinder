/* CheapFinder — content script glue.
 * Detects a product on the page, mounts the popover, asks the background
 * worker for live prices, and re-runs on SPA navigations. */
(function () {
  var CF = globalThis.CheapFinder;
  if (!CF || CF.__contentLoaded) return;
  CF.__contentLoaded = true;

  var DEFAULTS = { enabled: true, autoOpen: true, disabledHosts: [] };
  var panel = null;
  var lastUrl = null;
  var runToken = 0;

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get(DEFAULTS, function (items) {
          resolve(chrome.runtime.lastError ? DEFAULTS : items);
        });
      } catch (e) { resolve(DEFAULTS); }
    });
  }

  function teardown() {
    if (panel) { try { panel.destroy(); } catch (e) {} panel = null; }
  }

  function requestCompare(payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "cf-compare", payload: payload }, function (resp) {
          resolve(chrome.runtime.lastError ? null : resp);
        });
      } catch (e) { resolve(null); }
    });
  }

  function applyLiveResults(mounted, product, resp) {
    ["amazon", "ebay"].forEach(function (siteId) {
      var r = resp && resp[siteId];
      mounted.setLive(siteId, r && r.status === "done" ? r : { status: "error" });
    });
    // Highlight the cheapest live match that beats the page price.
    var pageAmount = product.price && product.price.amount;
    var bestSite = null, bestAmount = Infinity;
    ["amazon", "ebay"].forEach(function (siteId) {
      var r = resp && resp[siteId];
      var top = r && r.status === "done" && r.results && r.results[0];
      if (top && typeof top.priceAmount === "number" && top.priceAmount < bestAmount) {
        bestAmount = top.priceAmount;
        bestSite = siteId;
      }
    });
    if (bestSite && (!pageAmount || bestAmount < pageAmount)) mounted.markBest(bestSite);
  }

  function run() {
    var token = ++runToken;
    getSettings().then(function (settings) {
      if (token !== runToken) return;
      var host = location.hostname;
      if (!settings.enabled) return;
      if ((settings.disabledHosts || []).indexOf(host) !== -1) return;
      if (window !== window.top) return; // skip iframes

      var product = CF.extractProduct(document, location);
      teardown();
      if (!product.found) return;

      var assessment = CF.assessDropship(document, {});
      var query = CF.buildSearchQuery(product);
      if (!query) return;

      panel = CF.mountPanel({
        product: product,
        assessment: assessment,
        sites: CF.SITES,
        query: query,
        currentHost: host,
        liveEnabled: true,
        startOpen: settings.autoOpen,
        onClose: function () {}
      });
      var mounted = panel;

      requestCompare({
        query: query,
        domain: host,
        pageAmount: product.price ? product.price.amount : null
      }).then(function (resp) {
        if (token !== runToken || panel !== mounted) return;
        applyLiveResults(mounted, product, resp);
        if (resp && typeof resp.domainAgeMonths === "number") {
          // Domain age arrives after first paint; refresh the verdict by
          // remounting only if it changes the assessment.
          var withAge = CF.assessDropship(document, { domainAgeMonths: resp.domainAgeMonths });
          if (withAge.score !== assessment.score) {
            var wasOpen = true; // keep current visibility simple: reopen as before
            mounted.destroy();
            if (panel !== mounted) return;
            panel = CF.mountPanel({
              product: product, assessment: withAge, sites: CF.SITES,
              query: query, currentHost: host, liveEnabled: true,
              startOpen: settings.autoOpen && wasOpen, onClose: function () {}
            });
            applyLiveResults(panel, product, resp);
          }
        }
      });
    });
  }

  // Debounced SPA navigation watcher.
  var debounce = null;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearTimeout(debounce);
      debounce = setTimeout(run, 800);
    }
  }, 1000);

  lastUrl = location.href;
  run();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync") { teardown(); run(); }
    });
  } catch (e) {}
})();
