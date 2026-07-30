/* CheapFinder — product extraction.
 * Runs in a content script (isolated world) and inside the bookmarklet
 * (page world), so everything hangs off a single global namespace and
 * touches nothing else on the page. */
(function () {
  var CF = (globalThis.CheapFinder = globalThis.CheapFinder || {});

  var CURRENCY_SYMBOLS = {
    "$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY",
    "C$": "CAD", "CA$": "CAD", "A$": "AUD", "AU$": "AUD", "₹": "INR",
    "kr": "SEK", "zł": "PLN", "R$": "BRL", "₩": "KRW", "CHF": "CHF"
  };
  var CURRENCY_CODES = /\b(USD|EUR|GBP|JPY|CAD|AUD|INR|SEK|NOK|DKK|PLN|BRL|KRW|CHF|CNY|MXN|NZD)\b/i;

  /* "1,299.99" / "1.299,99" / "1299" / "$ 12.50" -> { amount, currency, raw } */
  CF.parsePrice = function (raw) {
    if (raw == null) return null;
    if (typeof raw === "number") {
      return isFinite(raw) && raw > 0 ? { amount: raw, currency: null, raw: String(raw) } : null;
    }
    var s = String(raw).trim();
    if (!s) return null;

    var currency = null;
    var codeMatch = s.match(CURRENCY_CODES);
    if (codeMatch) currency = codeMatch[1].toUpperCase();
    if (!currency) {
      // Longest symbols first so "CA$" wins over "$".
      var symbols = Object.keys(CURRENCY_SYMBOLS).sort(function (a, b) { return b.length - a.length; });
      for (var i = 0; i < symbols.length; i++) {
        if (s.indexOf(symbols[i]) !== -1) { currency = CURRENCY_SYMBOLS[symbols[i]]; break; }
      }
    }

    var numMatch = s.replace(/\s/g, "").match(/\d[\d.,]*/);
    if (!numMatch) return null;
    var num = numMatch[0];

    var lastDot = num.lastIndexOf(".");
    var lastComma = num.lastIndexOf(",");
    var normalized;
    if (lastDot !== -1 && lastComma !== -1) {
      // Whichever separator comes last is the decimal separator.
      normalized = lastDot > lastComma
        ? num.replace(/,/g, "")
        : num.replace(/\./g, "").replace(",", ".");
    } else if (lastComma !== -1) {
      var afterComma = num.length - lastComma - 1;
      // Exactly one comma followed by 1-2 digits reads as a decimal
      // separator ("29,9", "29,90"); otherwise commas group thousands.
      normalized = (num.indexOf(",") === lastComma && afterComma > 0 && afterComma <= 2)
        ? num.replace(",", ".")
        : num.replace(/,/g, "");
    } else if (lastDot !== -1) {
      var afterDot = num.length - lastDot - 1;
      if (afterDot === 3) {
        // "1.299" / "1.234.567": dot-groups of three read as European
        // thousands separators, not $1.299.
        normalized = num.replace(/\./g, "");
      } else if (num.indexOf(".") !== lastDot) {
        // Multiple dots, short last group ("1.234.56"): all but the last
        // are thousands separators.
        normalized = num.slice(0, lastDot).replace(/\./g, "") + num.slice(lastDot);
      } else {
        normalized = num;
      }
    } else {
      normalized = num;
    }

    var amount = parseFloat(normalized);
    if (!isFinite(amount) || amount <= 0) return null;
    return { amount: amount, currency: currency, raw: s };
  };

  function firstString(v) {
    if (v == null) return null;
    if (typeof v === "string") return v.trim() || null;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        var s = firstString(v[i]);
        if (s) return s;
      }
      return null;
    }
    if (typeof v === "object") return firstString(v.url || v.contentUrl || v.name || v["@id"]);
    return null;
  }

  function typeMatches(node, wanted) {
    var t = node && node["@type"];
    if (!t) return false;
    var types = Array.isArray(t) ? t : [t];
    return types.some(function (x) {
      return typeof x === "string" && x.toLowerCase().indexOf(wanted) !== -1;
    });
  }

  function collectJsonLdNodes(doc) {
    var out = [];
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var parsed;
      try { parsed = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
      var queue = Array.isArray(parsed) ? parsed.slice() : [parsed];
      while (queue.length) {
        var node = queue.shift();
        if (!node || typeof node !== "object") continue;
        out.push(node);
        if (Array.isArray(node["@graph"])) queue.push.apply(queue, node["@graph"]);
        if (node.mainEntity) queue.push(node.mainEntity);
      }
    }
    return out;
  }

  function offerPrice(offers) {
    if (!offers) return null;
    var list = Array.isArray(offers) ? offers : [offers];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || typeof o !== "object") continue;
      var candidates = [o.price, o.lowPrice, o.highPrice];
      for (var j = 0; j < candidates.length; j++) {
        var p = CF.parsePrice(candidates[j]);
        if (p) {
          if (!p.currency && typeof o.priceCurrency === "string") p.currency = o.priceCurrency.toUpperCase();
          if (!best || p.amount < best.amount) best = p;
        }
      }
      if (Array.isArray(o.offers) || (o.offers && typeof o.offers === "object")) {
        var nested = offerPrice(o.offers);
        if (nested && (!best || nested.amount < best.amount)) best = nested;
      }
    }
    return best;
  }

  function fromJsonLd(doc) {
    var nodes = collectJsonLdNodes(doc);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!typeMatches(node, "product")) continue;
      var title = firstString(node.name);
      if (!title) continue;
      return {
        method: "json-ld",
        title: title,
        price: offerPrice(node.offers),
        image: firstString(node.image),
        brand: firstString(node.brand),
        sku: firstString(node.sku),
        gtin: firstString(node.gtin13 || node.gtin12 || node.gtin14 || node.gtin8 || node.gtin || node.mpn)
      };
    }
    return null;
  }

  function metaContent(doc, selector) {
    var el = doc.querySelector(selector);
    var c = el && el.getAttribute("content");
    return c ? c.trim() : null;
  }

  function fromOpenGraph(doc) {
    var ogType = metaContent(doc, 'meta[property="og:type"]') || "";
    var isProduct = ogType.toLowerCase().indexOf("product") !== -1;
    var priceAmount =
      metaContent(doc, 'meta[property="product:price:amount"]') ||
      metaContent(doc, 'meta[property="og:price:amount"]');
    // A bare meta[itemprop=price] also shows up on category/list pages, so
    // it only counts as a price source, never as the product trigger.
    if (!priceAmount && isProduct) priceAmount = metaContent(doc, 'meta[itemprop="price"]');
    if (!isProduct && !priceAmount) return null;

    var title = metaContent(doc, 'meta[property="og:title"]') || (doc.title || "").trim();
    if (!title) return null;
    var price = CF.parsePrice(priceAmount);
    if (price && !price.currency) {
      var cur =
        metaContent(doc, 'meta[property="product:price:currency"]') ||
        metaContent(doc, 'meta[property="og:price:currency"]') ||
        metaContent(doc, 'meta[itemprop="priceCurrency"]');
      if (cur) price.currency = cur.toUpperCase();
    }
    return {
      method: "opengraph",
      title: title,
      price: price,
      image: metaContent(doc, 'meta[property="og:image"]') || metaContent(doc, 'meta[property="og:image:url"]'),
      brand: metaContent(doc, 'meta[property="product:brand"]'),
      sku: metaContent(doc, 'meta[property="product:retailer_item_id"]'),
      gtin: null
    };
  }

  function itempropValue(scope, name) {
    var el = scope.querySelector('[itemprop="' + name + '"]');
    if (!el) return null;
    var v = el.getAttribute("content") || el.getAttribute("src") || el.getAttribute("href") || el.textContent;
    return v ? String(v).trim() || null : null;
  }

  function fromMicrodata(doc) {
    var scope = doc.querySelector('[itemtype*="schema.org/Product" i]');
    if (!scope) return null;
    var title = itempropValue(scope, "name");
    if (!title) return null;
    var price = CF.parsePrice(itempropValue(scope, "price") || itempropValue(scope, "lowPrice"));
    if (price && !price.currency) {
      var cur = itempropValue(scope, "priceCurrency");
      if (cur) price.currency = cur.toUpperCase();
    }
    return {
      method: "microdata",
      title: title,
      price: price,
      image: itempropValue(scope, "image"),
      brand: itempropValue(scope, "brand"),
      sku: itempropValue(scope, "sku"),
      gtin: itempropValue(scope, "gtin13") || itempropValue(scope, "gtin")
    };
  }

  var PRODUCT_PATH = /\/(products?|item|itm|dp|listing|p|pd|goods|prod)\/|-p-\d|\/p\d{5,}/i;

  var PRICE_PATTERN = /(?:US?\$|CA?\$|AU?\$|[$€£¥]|\b(?:USD|CAD|EUR|GBP|AUD)\b)\s?\d[\d.,]*/;

  // Shops almost universally label the price element with a "price" class.
  function guessPrice(doc) {
    var els = doc.querySelectorAll('[itemprop="price"], [data-price], [class*="price" i]');
    for (var i = 0; i < Math.min(els.length, 20); i++) {
      var t = (els[i].getAttribute("content") || els[i].textContent || "").slice(0, 60);
      var m = t.match(PRICE_PATTERN);
      var p = m && CF.parsePrice(m[0]);
      if (p) return p;
    }
    var body = doc.body ? (doc.body.textContent || "").slice(0, 200000) : "";
    var bm = body.match(PRICE_PATTERN);
    return bm ? CF.parsePrice(bm[0]) : null;
  }

  function guessImage(doc) {
    var og = metaContent(doc, 'meta[property="og:image"]');
    if (og) return og;
    var best = null, bestArea = 40000; // ignore icons/thumbnails
    var imgs = doc.images || [];
    for (var i = 0; i < Math.min(imgs.length, 300); i++) {
      var im = imgs[i];
      var src = im.currentSrc || im.src || "";
      if (!src || src.slice(0, 5) === "data:" || /\.svg(\?|$)/i.test(src)) continue;
      var area = (im.naturalWidth || im.width || 0) * (im.naturalHeight || im.height || 0);
      if (area > bestArea) { bestArea = area; best = src; }
    }
    return best;
  }

  // "SHEIN Frenchy Linen Pants | SHEIN USA" -> longest segment wins.
  function cleanTitle(t) {
    if (!t) return null;
    var parts = String(t).split(/\s*[|•]\s*/);
    var best = "";
    for (var i = 0; i < parts.length; i++) if (parts[i].length > best.length) best = parts[i];
    best = best.replace(/\s+/g, " ").trim();
    return best.length >= 3 ? best : null;
  }

  function bestGuessTitle(doc) {
    var h1 = doc.querySelector("h1");
    var t = h1 && h1.textContent ? cleanTitle(h1.textContent) : null;
    return t ||
      cleanTitle(metaContent(doc, 'meta[property="og:title"]')) ||
      cleanTitle(metaContent(doc, 'meta[name="twitter:title"]')) ||
      cleanTitle(doc.title);
  }

  function fromHeuristics(doc, loc) {
    if (!loc || !PRODUCT_PATH.test(loc.pathname || "")) return null;
    var title = bestGuessTitle(doc);
    if (!title) return null;
    return {
      method: "heuristic",
      title: title,
      price: guessPrice(doc),
      image: guessImage(doc),
      brand: null, sku: null, gtin: null
    };
  }

  function absolutize(url, loc) {
    if (!url) return null;
    try { return new URL(url, loc && loc.href ? loc.href : undefined).href; } catch (e) { return url; }
  }

  function finalize(p, loc) {
    p.found = true;
    p.title = p.title.replace(/\s+/g, " ").trim().slice(0, 300);
    p.image = absolutize(p.image, loc);
    p.url = loc && loc.href ? loc.href : null;
    return p;
  }

  CF.extractProduct = function (doc, loc) {
    var p = null;
    try { p = fromJsonLd(doc); } catch (e) {}
    if (!p) { try { p = fromOpenGraph(doc); } catch (e) {} }
    if (!p) { try { p = fromMicrodata(doc); } catch (e) {} }
    if (!p) { try { p = fromHeuristics(doc, loc); } catch (e) {} }
    if (!p) return { found: false };
    return finalize(p, loc);
  };

  /* For explicit invocations (the bookmarklet): the user asked, so always
   * produce a best guess rather than giving up — any title will do, with a
   * "fallback" method so the UI can flag lower confidence. */
  CF.extractProductLoose = function (doc, loc) {
    var p = CF.extractProduct(doc, loc);
    if (p.found) return p;
    var title = null;
    try { title = bestGuessTitle(doc); } catch (e) {}
    if (!title) return { found: false };
    var guess = { method: "fallback", title: title, brand: null, sku: null, gtin: null, price: null, image: null };
    try { guess.price = guessPrice(doc); } catch (e) {}
    try { guess.image = guessImage(doc); } catch (e) {}
    return finalize(guess, loc);
  };
})();
