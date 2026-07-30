/* CheapFinder — popover UI. Rendered inside a shadow root so page CSS
 * can't restyle it. All dynamic strings (product titles, prices —
 * including ones parsed out of third-party search results) are set via
 * textContent, never innerHTML. */
(function () {
  var CF = (globalThis.CheapFinder = globalThis.CheapFinder || {});

  var STYLE = "" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
    ".root{position:fixed;bottom:16px;right:16px;z-index:2147483647;color:#e8eaed}" +
    ".badge{display:flex;align-items:center;gap:6px;background:#1a1c22;border:1px solid #34384a;border-radius:999px;" +
      "padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35);color:#e8eaed}" +
    ".badge:hover{border-color:#5b8cff}" +
    ".badge .dot{width:8px;height:8px;border-radius:50%;background:#5b8cff}" +
    ".badge .dot.warn{background:#f0b429}.badge .dot.bad{background:#ef5350}.badge .dot.ok{background:#46c07a}" +
    ".panel{width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));overflow-y:auto;background:#1a1c22;" +
      "border:1px solid #34384a;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-size:13px}" +
    ".hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #2a2d38}" +
    ".hdr .brand{font-weight:700;font-size:13px;letter-spacing:.2px}" +
    ".hdr .brand span{color:#5b8cff}" +
    ".iconbtn{background:none;border:none;color:#9aa0a6;cursor:pointer;font-size:15px;padding:2px 6px;border-radius:6px}" +
    ".iconbtn:hover{background:#2a2d38;color:#e8eaed}" +
    ".prod{display:flex;gap:10px;padding:12px 14px;align-items:center}" +
    ".prod img{width:44px;height:44px;object-fit:cover;border-radius:8px;background:#2a2d38;flex:none}" +
    ".prod .t{font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}" +
    ".prod .p{color:#9aa0a6;margin-top:2px;font-size:12px}" +
    ".verdict{margin:0 14px 10px;padding:8px 10px;border-radius:9px;font-weight:600;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;cursor:pointer}" +
    ".verdict.bad{background:rgba(239,83,80,.12);color:#ff8a80}" +
    ".verdict.warn{background:rgba(240,180,41,.12);color:#ffd54f}" +
    ".verdict.ok{background:rgba(70,192,122,.12);color:#69db97}" +
    ".verdict .chev{font-weight:400;opacity:.7}" +
    ".signals{margin:0 14px 10px;padding:0 2px;list-style:none;color:#b6bac2;font-size:12px;display:none}" +
    ".signals li{padding:3px 0 3px 16px;position:relative}" +
    ".signals li:before{content:'•';position:absolute;left:4px;color:#5b8cff}" +
    "table{width:100%;border-collapse:collapse}" +
    "th{text-align:left;color:#9aa0a6;font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:6px 14px;border-top:1px solid #2a2d38}" +
    "td{padding:7px 14px;border-top:1px solid #23252e;vertical-align:top}" +
    "td.site{font-weight:600;white-space:nowrap}" +
    "td.price{text-align:right;white-space:nowrap}" +
    ".best td{background:rgba(70,192,122,.08)}" +
    ".best td.price .amt{color:#69db97;font-weight:700}" +
    "a{color:#8ab4f8;text-decoration:none}a:hover{text-decoration:underline}" +
    ".muted{color:#9aa0a6}.small{font-size:11.5px}" +
    ".match{display:block;color:#9aa0a6;font-size:11px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".spin{display:inline-block;width:11px;height:11px;border:2px solid #34384a;border-top-color:#8ab4f8;border-radius:50%;animation:cfspin .8s linear infinite;vertical-align:-2px}" +
    "@keyframes cfspin{to{transform:rotate(360deg)}}" +
    ".foot{padding:9px 14px 12px;color:#70757d;font-size:11px;line-height:1.45;border-top:1px solid #2a2d38}" +
    ".foot a{color:#9aa0a6}" +
    "@media (max-width:480px){.root{bottom:8px;right:8px;left:8px}.panel{width:auto}}";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function link(href, text, cls) {
    var a = el("a", cls || null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    return a;
  }

  function fmtPrice(p) {
    if (!p) return null;
    var cur = p.currency;
    var sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur ? cur + " " : "$";
    return sym + (Math.round(p.amount * 100) / 100).toFixed(2);
  }

  /* opts: { product, assessment, sites, query, currentHost, liveEnabled, onClose } */
  CF.mountPanel = function (opts) {
    var host = el("div");
    host.setAttribute("data-cheapfinder", "1");
    // Closed by default so the (possibly hostile) shop page can't rewrite
    // the verdict or swap link targets. opts.exposeShadow is a test hook.
    var shadow = host.attachShadow({ mode: opts.exposeShadow ? "open" : "closed" });
    // adoptedStyleSheets is immune to the page's style-src CSP; fall back
    // to a <style> element where constructable sheets are unavailable.
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      var style = el("style");
      style.textContent = STYLE;
      shadow.appendChild(style);
    }

    var root = el("div", "root");
    shadow.appendChild(root);

    var state = { open: false, rows: {} };
    var tone = (opts.assessment && opts.assessment.tone) || "ok";

    var badge = el("button", "badge");
    badge.appendChild(el("span", "dot " + tone));
    badge.appendChild(el("span", null, "CheapFinder"));

    var panel = el("div", "panel");

    var hdr = el("div", "hdr");
    var brand = el("div", "brand", "Cheap");
    brand.appendChild(el("span", null, "Finder"));
    hdr.appendChild(brand);
    var closeBtn = el("button", "iconbtn", "✕");
    closeBtn.setAttribute("aria-label", "Collapse");
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    var prod = el("div", "prod");
    if (opts.product.image) {
      var img = el("img");
      img.src = opts.product.image;
      img.alt = "";
      img.addEventListener("error", function () { img.remove(); });
      prod.appendChild(img);
    }
    var pText = el("div");
    pText.appendChild(el("div", "t", opts.product.title));
    var pagePrice = fmtPrice(opts.product.price);
    var sub = pagePrice ? "This page: " + pagePrice : "Price on page not detected";
    if (opts.product.method === "fallback") sub += " · best guess, check the title";
    pText.appendChild(el("div", "p", sub));
    prod.appendChild(pText);
    panel.appendChild(prod);

    if (opts.assessment) {
      var verdict = el("div", "verdict " + tone);
      verdict.appendChild(el("span", null,
        opts.assessment.verdict + " (" + opts.assessment.score + "/" + opts.assessment.max + ")"));
      verdict.appendChild(el("span", "chev", "▾"));
      panel.appendChild(verdict);
      var sigList = el("ul", "signals");
      if (opts.assessment.signals.length) {
        opts.assessment.signals.forEach(function (s) {
          sigList.appendChild(el("li", null, s.label + " (+" + s.weight + ")"));
        });
      } else {
        sigList.appendChild(el("li", null, "No drop-shipping markers found on this page"));
      }
      panel.appendChild(sigList);
      verdict.addEventListener("click", function () {
        sigList.style.display = sigList.style.display === "block" ? "none" : "block";
      });
    }

    var table = el("table");
    var thead = el("thead");
    var thr = el("tr");
    thr.appendChild(el("th", null, "Site"));
    var thPrice = el("th", null, "Best price");
    thPrice.style.textAlign = "right";
    thr.appendChild(thPrice);
    thead.appendChild(thr);
    table.appendChild(thead);
    var tbody = el("tbody");
    table.appendChild(tbody);

    (opts.sites || []).forEach(function (site) {
      var h = opts.currentHost || "";
      if (h === site.host || h.slice(-(site.host.length + 1)) === "." + site.host) return;
      var tr = el("tr");
      var tdSite = el("td", "site");
      tdSite.appendChild(link(site.searchUrl(opts.query), site.name));
      tr.appendChild(tdSite);
      var tdPrice = el("td", "price");
      if (site.live && opts.liveEnabled) {
        tdPrice.appendChild(el("span", "spin"));
      } else {
        tdPrice.appendChild(link(site.searchUrl(opts.query), "search →", "small"));
      }
      tr.appendChild(tdPrice);
      tbody.appendChild(tr);
      state.rows[site.id] = { tr: tr, tdPrice: tdPrice, site: site };
    });

    var lens = CF.lensUrl(opts.product.image);
    if (lens) {
      var tr = el("tr");
      var tdSite = el("td", "site");
      tdSite.appendChild(link(lens, "Google Lens"));
      tr.appendChild(tdSite);
      var tdPrice = el("td", "price");
      tdPrice.appendChild(link(lens, "by image →", "small"));
      tr.appendChild(tdPrice);
      tbody.appendChild(tr);
    }
    panel.appendChild(table);

    var foot = el("div", "foot");
    foot.appendChild(document.createTextNode(
      "Heuristics only — verify before buying. No tracking or accounts; " +
      (opts.liveEnabled
        ? "live lookups query Amazon/eBay directly (toggle in settings). "
        : "links only, nothing leaves this page. ")));
    foot.appendChild(link("https://github.com/tooaverage/cheapfinder", "About"));
    panel.appendChild(foot);

    function setOpen(open) {
      state.open = open;
      root.textContent = "";
      root.appendChild(open ? panel : badge);
    }
    badge.addEventListener("click", function () { setOpen(true); });
    closeBtn.addEventListener("click", function () {
      setOpen(false);
      if (opts.onClose) opts.onClose();
    });

    setOpen(!!opts.startOpen);
    (document.body || document.documentElement).appendChild(host);

    return {
      host: host,
      /* result: {status:'done'|'error', results:[{title,priceRaw,priceAmount,url}]} */
      setLive: function (siteId, result) {
        var row = state.rows[siteId];
        if (!row) return;
        var td = row.tdPrice;
        td.textContent = "";
        var results = (result && result.results) || [];
        if (result && result.status === "done" && results.length) {
          var best = results[0];
          var a = link(best.url || row.site.searchUrl(opts.query), best.priceRaw || "view");
          a.className = "amt";
          td.appendChild(a);
          if (best.title) {
            var m = el("span", "match", best.title);
            m.title = best.title;
            td.appendChild(m);
          }
        } else {
          td.appendChild(link(row.site.searchUrl(opts.query), "search →", "small muted"));
        }
      },
      isOpen: function () { return state.open; },
      markBest: function (siteId) {
        var row = state.rows[siteId];
        if (row) row.tr.className = "best";
      },
      destroy: function () { host.remove(); }
    };
  };
})();
