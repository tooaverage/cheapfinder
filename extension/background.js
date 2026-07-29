/* CheapFinder — MV3 service worker.
 * Best-effort live price lookups. Amazon/eBay may serve a bot wall; every
 * failure degrades to {status:"error"} and the panel falls back to plain
 * search links. No DOMParser in service workers, hence regex parsing. */

importScripts("shared/sites.js");

var CF = globalThis.CheapFinder;
var FETCH_TIMEOUT_MS = 9000;
var MIN_SIMILARITY = 0.3;
var MAX_RESULTS = 3;

function timeoutSignal(ms) {
  if (AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
  var c = new AbortController();
  setTimeout(function () { c.abort(); }, ms);
  return c.signal;
}

function fetchText(url) {
  return fetch(url, {
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    credentials: "omit",
    headers: { "Accept": "text/html,application/xhtml+xml" }
  }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#34": '"' };
function decodeEntities(s) {
  return String(s || "").replace(/&(#?x?[0-9a-z]+);/gi, function (m, code) {
    if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
    if (code[0] === "#") {
      var n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (isFinite(n) && n > 0 && n < 0x10ffff) { try { return String.fromCodePoint(n); } catch (e) {} }
    }
    return m;
  }).replace(/\s+/g, " ").trim();
}

function priceAmount(raw) {
  var m = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return m ? parseFloat(m[0]) : null;
}

function rankResults(items, query) {
  var scored = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.title || !it.priceRaw || it.priceAmount == null) continue;
    var sim = CF.titleSimilarity(query, it.title);
    if (sim < MIN_SIMILARITY) continue;
    it.similarity = Math.round(sim * 100) / 100;
    scored.push(it);
  }
  scored.sort(function (a, b) { return a.priceAmount - b.priceAmount; });
  return scored.slice(0, MAX_RESULTS);
}

function parseAmazon(html) {
  var items = [];
  // The ASIN sits in the same tag, before the split marker — recover it
  // from the tail of the preceding chunk.
  var heads = html.split(/data-component-type="s-search-result"/);
  for (var i = 1; i < heads.length; i++) {
    var chunk = heads[i].slice(0, 60000);
    var asinMatch = heads[i - 1].slice(-2000).match(/data-asin="([A-Z0-9]{10})"(?![\s\S]*data-asin=)/);
    var titleMatch =
      chunk.match(/<h2[^>]*>[\s\S]{0,500}?<span[^>]*>([^<]{5,400})<\/span>/) ||
      chunk.match(/<img[^>]+alt="([^"]{5,400})"/);
    var priceMatch = chunk.match(/class="a-offscreen"[^>]*>([^<]{1,30})</);
    if (!titleMatch || !priceMatch) continue;
    var title = decodeEntities(titleMatch[1]);
    if (/^sponsored$/i.test(title)) continue;
    var raw = decodeEntities(priceMatch[1]);
    items.push({
      title: title,
      priceRaw: raw,
      priceAmount: priceAmount(raw),
      url: asinMatch ? "https://www.amazon.com/dp/" + asinMatch[1] : null
    });
  }
  return items;
}

function parseEbay(html) {
  var items = [];
  var chunks = html.split(/class="s-item(?:__wrapper|\s|")/).slice(1);
  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i].slice(0, 30000);
    var titleMatch = chunk.match(/class="s-item__title"[^>]*>(?:\s*<[^>]+>)*([^<]{5,400})</);
    var priceMatch = chunk.match(/class="s-item__price"[^>]*>(?:\s*<[^>]+>)*([^<]{1,40})</);
    var urlMatch = chunk.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"]+)"/);
    if (!titleMatch || !priceMatch) continue;
    var title = decodeEntities(titleMatch[1]);
    if (/shop on ebay/i.test(title)) continue; // placeholder card
    var raw = decodeEntities(priceMatch[1]);
    items.push({
      title: title,
      priceRaw: raw,
      priceAmount: priceAmount(raw),
      url: urlMatch ? urlMatch[1].split("?")[0] : null
    });
  }
  return items;
}

/* Minimal registrable-domain guess for RDAP (handles common two-part TLDs). */
var TWO_PART_TLDS = ["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx", "co.in", "com.sg", "com.hk", "co.kr", "com.tw", "com.cn"];
function registrableDomain(host) {
  var h = String(host || "").toLowerCase().replace(/\.$/, "");
  var parts = h.split(".");
  if (parts.length <= 2) return h;
  var lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.indexOf(lastTwo) !== -1) return parts.slice(-3).join(".");
  return lastTwo;
}

function fetchDomainAgeMonths(host) {
  var domain = registrableDomain(host);
  if (!domain || domain.indexOf(".") === -1) return Promise.resolve(null);
  return fetch("https://rdap.org/domain/" + encodeURIComponent(domain), {
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    credentials: "omit",
    headers: { "Accept": "application/rdap+json, application/json" }
  }).then(function (res) {
    if (!res.ok) return null;
    return res.json();
  }).then(function (data) {
    if (!data || !Array.isArray(data.events)) return null;
    for (var i = 0; i < data.events.length; i++) {
      var ev = data.events[i];
      if (ev && ev.eventAction === "registration" && ev.eventDate) {
        var reg = Date.parse(ev.eventDate);
        if (isFinite(reg)) {
          return Math.max(0, Math.floor((Date.now() - reg) / (30.44 * 24 * 3600 * 1000)));
        }
      }
    }
    return null;
  }).catch(function () { return null; });
}

function liveSearch(siteId, url, parser, query) {
  return fetchText(url)
    .then(function (html) {
      return { status: "done", results: rankResults(parser(html), query) };
    })
    .catch(function (e) {
      return { status: "error", error: String(e && e.message || e) };
    });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== "cf-compare" || !msg.payload) return;
  var q = String(msg.payload.query || "").slice(0, 150);
  var domain = String(msg.payload.domain || "");
  if (!q) { sendResponse(null); return; }

  Promise.all([
    liveSearch("amazon", "https://www.amazon.com/s?k=" + encodeURIComponent(q), parseAmazon, q),
    liveSearch("ebay", "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(q), parseEbay, q),
    fetchDomainAgeMonths(domain)
  ]).then(function (out) {
    sendResponse({ amazon: out[0], ebay: out[1], domainAgeMonths: out[2] });
  }).catch(function () {
    sendResponse(null);
  });
  return true; // async sendResponse
});
