/* CheapFinder — drop-shipping signal scoring.
 * Every check is a heuristic; the panel presents them as signals, never
 * as proof. Scores are additive and capped at MAX_SCORE. Signals are
 * deliberately conservative: apps like Loox/AfterShip that plenty of
 * legitimate shops use do NOT count. */
(function () {
  var CF = (globalThis.CheapFinder = globalThis.CheapFinder || {});

  CF.MAX_SCORE = 10;

  // Apps whose sole purpose is drop-ship fulfilment / AliExpress import.
  var DROPSHIP_APPS = [
    "dsers", "oberlo", "zendrop", "cjdropshipping", "spocket", "autods",
    "eprolo", "dropified", "importify", "alireviews"
  ];

  function scriptSources(doc) {
    var out = [];
    var scripts = doc.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) out.push(scripts[i].getAttribute("src") || "");
    return out.join("\n").toLowerCase();
  }

  // Word-ish boundary match so "autods" can't fire inside a random hash.
  function containsToken(haystack, needle) {
    return new RegExp("(^|[^a-z0-9])" + needle + "([^a-z0-9]|$)").test(haystack);
  }

  function imageSources(doc) {
    var out = [];
    var imgs = doc.querySelectorAll("img[src], img[data-src], source[srcset]");
    for (var i = 0; i < imgs.length; i++) {
      out.push(imgs[i].getAttribute("src") || "", imgs[i].getAttribute("data-src") || "", imgs[i].getAttribute("srcset") || "");
    }
    return out.join("\n").toLowerCase();
  }

  /* Selector probes only — never serialize the document (huge DOMs). */
  function detectPlatform(doc, srcs) {
    if (srcs.indexOf("cdn.shopify.com") !== -1 ||
        doc.querySelector('link[href*="cdn.shopify.com"], meta[content*="Shopify" i]')) return "Shopify";
    var gen = doc.querySelector('meta[name="generator"]');
    var g = gen && gen.getAttribute("content") ? gen.getAttribute("content").toLowerCase() : "";
    if (g.indexOf("woocommerce") !== -1 ||
        doc.querySelector('link[href*="/wp-content/plugins/woocommerce"], body.woocommerce, body.woocommerce-page')) return "WooCommerce";
    if (g.indexOf("wix") !== -1) return "Wix";
    if (g.indexOf("bigcommerce") !== -1 || srcs.indexOf("bigcommerce.com") !== -1) return "BigCommerce";
    return null;
  }

  // Delivery ranges only count near shipping-related words, so "refunds are
  // processed in 7-14 days" in a returns policy doesn't fire.
  var SHIPPING_RANGE = /(?:shipping|delivery|deliver(?:y|ed)?|arriv\w+|dispatch\w*|transit)[^.!?]{0,80}?(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:business\s*|working\s*)?days/;

  /* domainAgeMonths comes from the background RDAP lookup and may be null. */
  CF.assessDropship = function (doc, opts) {
    opts = opts || {};
    var signals = [];
    var srcs = "";
    var imgs = "";
    var text = "";
    try { srcs = scriptSources(doc); } catch (e) {}
    try { imgs = imageSources(doc); } catch (e) {}
    try { text = (doc.body ? doc.body.textContent || "" : "").toLowerCase(); } catch (e) {}

    var platform = null;
    try { platform = detectPlatform(doc, srcs); } catch (e) {}
    if (platform === "Shopify" || platform === "WooCommerce" || platform === "Wix") {
      signals.push({ id: "platform", weight: 1, label: platform + " storefront (common for drop-ship shops)" });
    }

    var apps = DROPSHIP_APPS.filter(function (a) { return containsToken(srcs, a); });
    if (apps.length) {
      signals.push({ id: "apps", weight: 3, label: "Drop-shipping app detected: " + apps.slice(0, 3).join(", ") });
    }

    if (imgs.indexOf("alicdn.com") !== -1 || imgs.indexOf("aliexpress-media.com") !== -1 || imgs.indexOf("kwcdn.com") !== -1) {
      signals.push({ id: "cdn", weight: 3, label: "Product images hosted on AliExpress/Temu CDNs" });
    }

    var shipMatch = text.match(SHIPPING_RANGE);
    if (shipMatch && parseInt(shipMatch[2], 10) >= 10) {
      signals.push({ id: "shipping", weight: 2, label: "Long delivery estimate on page (" + shipMatch[1] + "-" + shipMatch[2] + " days)" });
    } else if (/ships?\s+from\s+(china|overseas)|overseas\s+warehouse/.test(text)) {
      signals.push({ id: "shipping", weight: 2, label: "Page mentions shipping from China / overseas warehouse" });
    }

    // "Only N left in stock" alone is genuine retail phrasing (Amazon uses
    // it) — only social-pressure widgets count.
    if (/people\s+are\s+viewing|selling\s+fast|hurry[,!\s]|sale\s+ends\s+in|\d+\s+sold\s+in\s+the\s+last/.test(text)) {
      signals.push({ id: "urgency", weight: 1, label: "Urgency widgets (social-pressure pattern)" });
    }

    if (/free\s+worldwide\s+shipping/.test(text)) {
      signals.push({ id: "worldwide", weight: 1, label: "“Free worldwide shipping” offer" });
    }

    if (typeof opts.domainAgeMonths === "number" && opts.domainAgeMonths >= 0 && opts.domainAgeMonths < 18) {
      signals.push({ id: "domain-age", weight: 2, label: "Domain registered only " + opts.domainAgeMonths + " month(s) ago" });
    }

    var score = 0;
    for (var i = 0; i < signals.length; i++) score += signals[i].weight;
    if (score > CF.MAX_SCORE) score = CF.MAX_SCORE;

    var verdict, tone;
    if (score >= 6) { verdict = "High chance this is drop-shipped"; tone = "bad"; }
    else if (score >= 3) { verdict = "Some drop-shipping signals"; tone = "warn"; }
    else { verdict = "Few drop-shipping signals"; tone = "ok"; }

    return { score: score, max: CF.MAX_SCORE, signals: signals, verdict: verdict, tone: tone, platform: platform };
  };
})();
