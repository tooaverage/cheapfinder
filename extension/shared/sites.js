/* CheapFinder — comparison-site definitions and query helpers. */
(function () {
  var CF = (globalThis.CheapFinder = globalThis.CheapFinder || {});

  var NOISE_WORDS = [
    "new", "hot", "sale", "best", "premium", "luxury", "official", "original",
    "free", "shipping", "2024", "2025", "2026", "upgraded", "improved", "pcs",
    "pack", "set", "with", "for", "and", "the", "a", "an", "of", "in", "on",
    "to", "by", "black", "white", "friday"
  ];

  CF.buildSearchQuery = function (product) {
    var title = (product && product.title) || "";
    var tokens = title
      .replace(/[|/,()\[\]{}™®©–—-]+/g, " ")
      .split(/\s+/)
      .filter(function (t) {
        if (!t) return false;
        var lower = t.toLowerCase();
        return NOISE_WORDS.indexOf(lower) === -1 && !/^[!%*&#@+~^"'.:;?]+$/.test(t);
      });
    var q = tokens.slice(0, 8).join(" ").trim();
    if (product && product.brand && q.toLowerCase().indexOf(product.brand.toLowerCase()) === -1) {
      q = product.brand + " " + q;
    }
    return q.slice(0, 120).trim() || title.slice(0, 120).trim();
  };

  function enc(q) { return encodeURIComponent(q); }

  /* live:true means the extension background worker tries to fetch and
   * parse real prices; everything else is a one-tap search link. */
  CF.SITES = [
    { id: "amazon", name: "Amazon", live: true, host: "amazon.com",
      searchUrl: function (q) { return "https://www.amazon.com/s?k=" + enc(q); } },
    { id: "ebay", name: "eBay", live: true, host: "ebay.com",
      searchUrl: function (q) { return "https://www.ebay.com/sch/i.html?_nkw=" + enc(q); } },
    { id: "aliexpress", name: "AliExpress", live: false, host: "aliexpress.com",
      searchUrl: function (q) { return "https://www.aliexpress.com/wholesale?SearchText=" + enc(q); } },
    { id: "temu", name: "Temu", live: false, host: "temu.com",
      searchUrl: function (q) { return "https://www.temu.com/search_result.html?search_key=" + enc(q); } },
    { id: "walmart", name: "Walmart", live: false, host: "walmart.com",
      searchUrl: function (q) { return "https://www.walmart.com/search?q=" + enc(q); } },
    { id: "gshopping", name: "Google Shopping", live: false, host: "google.com",
      searchUrl: function (q) { return "https://www.google.com/search?udm=28&q=" + enc(q); } }
  ];

  CF.lensUrl = function (imageUrl) {
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
    return "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(imageUrl);
  };

  var STOP = { the: 1, a: 1, an: 1, and: 1, or: 1, of: 1, for: 1, with: 1, to: 1, in: 1, on: 1, "new": 1 };

  function tokenSet(s) {
    var set = {};
    String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).forEach(function (t) {
      if (t.length > 1 && !STOP[t]) set[t] = 1;
    });
    return set;
  }

  /* Overlap coefficient: |A ∩ B| / min(|A|,|B|). Robust when one title is
   * much longer than the other (Amazon titles are essays). */
  CF.titleSimilarity = function (a, b) {
    var A = tokenSet(a), B = tokenSet(b);
    var keysA = Object.keys(A), keysB = Object.keys(B);
    if (!keysA.length || !keysB.length) return 0;
    var inter = 0;
    for (var i = 0; i < keysA.length; i++) if (B[keysA[i]]) inter++;
    return inter / Math.min(keysA.length, keysB.length);
  };
})();
