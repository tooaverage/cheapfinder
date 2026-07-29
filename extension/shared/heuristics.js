/* CheapFinder — drop-shipping signal scoring.
 * Every check is a heuristic; the panel presents them as signals, never
 * as proof. Scores are additive and capped at MAX_SCORE. */
(function () {
  var CF = (globalThis.CheapFinder = globalThis.CheapFinder || {});

  CF.MAX_SCORE = 10;

  var DROPSHIP_APPS = [
    "dsers", "oberlo", "zendrop", "cjdropshipping", "spocket", "autods",
    "eprolo", "dropified", "importify", "alireviews", "loox", "vitals-app",
    "trackingmore", "aftership", "17track"
  ];

  function scriptSources(doc) {
    var out = [];
    var scripts = doc.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) out.push(scripts[i].getAttribute("src") || "");
    return out.join("\n").toLowerCase();
  }

  function imageSources(doc) {
    var out = [];
    var imgs = doc.querySelectorAll("img[src], img[data-src], source[srcset]");
    for (var i = 0; i < imgs.length; i++) {
      out.push(imgs[i].getAttribute("src") || "", imgs[i].getAttribute("data-src") || "", imgs[i].getAttribute("srcset") || "");
    }
    return out.join("\n").toLowerCase();
  }

  function detectPlatform(doc, srcs) {
    var html = (doc.documentElement.innerHTML || "").slice(0, 400000).toLowerCase();
    if (srcs.indexOf("cdn.shopify.com") !== -1 || html.indexOf("shopify.shop") !== -1 || html.indexOf("cdn.shopify.com") !== -1) return "Shopify";
    var gen = doc.querySelector('meta[name="generator"]');
    var g = gen && gen.getAttribute("content") ? gen.getAttribute("content").toLowerCase() : "";
    if (g.indexOf("woocommerce") !== -1 || html.indexOf("woocommerce") !== -1) return "WooCommerce";
    if (g.indexOf("wix") !== -1) return "Wix";
    if (html.indexOf("bigcommerce") !== -1) return "BigCommerce";
    return null;
  }

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

    var apps = DROPSHIP_APPS.filter(function (a) { return srcs.indexOf(a) !== -1; });
    if (apps.length) {
      signals.push({ id: "apps", weight: 3, label: "Drop-shipping/fulfilment app detected: " + apps.slice(0, 3).join(", ") });
    }

    if (imgs.indexOf("alicdn.com") !== -1 || imgs.indexOf("aliexpress-media.com") !== -1 || imgs.indexOf("kwcdn.com") !== -1) {
      signals.push({ id: "cdn", weight: 3, label: "Product images hosted on AliExpress/Temu CDNs" });
    }

    var shipMatch = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:business\s*|working\s*)?days/);
    if (shipMatch && parseInt(shipMatch[2], 10) >= 10) {
      signals.push({ id: "shipping", weight: 2, label: "Long delivery estimate on page (" + shipMatch[0].trim() + ")" });
    } else if (/ships?\s+from\s+(china|overseas)|overseas\s+warehouse/.test(text)) {
      signals.push({ id: "shipping", weight: 2, label: "Page mentions shipping from China / overseas warehouse" });
    }

    if (/only\s+\d+\s+left|people\s+are\s+viewing|selling\s+fast|hurry[,!\s]|sale\s+ends\s+in|\d+\s+sold\s+in\s+the\s+last/.test(text)) {
      signals.push({ id: "urgency", weight: 1, label: "Urgency widgets (fake-scarcity pattern)" });
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
