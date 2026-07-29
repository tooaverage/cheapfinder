/* CheapFinder — bookmarklet entry point. The build script concatenates the
 * shared modules above this file and wraps everything in an IIFE, so CF is
 * fully populated by the time this runs. Runs in the page's world: no
 * chrome.* APIs, no cross-origin fetch — links-only mode. */
(function () {
  var CF = globalThis.CheapFinder;

  // Second tap on the bookmark removes the panel.
  var existing = document.querySelector("[data-cheapfinder]");
  if (existing) { existing.remove(); return; }

  var product = CF.extractProduct(document, location);
  if (!product.found) {
    alert("CheapFinder: no product detected on this page.");
    return;
  }

  var assessment = CF.assessDropship(document, {});
  var query = CF.buildSearchQuery(product);

  CF.mountPanel({
    product: product,
    assessment: assessment,
    sites: CF.SITES,
    query: query,
    currentHost: location.hostname,
    liveEnabled: false,
    startOpen: true
  });
})();
