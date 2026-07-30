import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCF, fixture } from "./helpers.mjs";

test("JSON-LD product extraction wins and parses offer", () => {
  const { CF, document, window } = loadCF(fixture("shopify-product.html"));
  const p = CF.extractProduct(document, window.location);
  assert.equal(p.found, true);
  assert.equal(p.method, "json-ld");
  assert.equal(p.title, "Ultra Portable Neck Fan 4000mAh Bladeless");
  assert.equal(p.price.amount, 49.99);
  assert.equal(p.price.currency, "USD");
  assert.equal(p.brand, "GadgetGlow");
  assert.equal(p.image, "https://ae01.alicdn.com/kf/fan123.jpg");
});

test("OpenGraph extraction with European price format", () => {
  const { CF, document, window } = loadCF(fixture("og-product.html"), "https://craftco.example/p/organizer");
  const p = CF.extractProduct(document, window.location);
  assert.equal(p.method, "opengraph");
  assert.equal(p.title, "Walnut Desk Organizer");
  assert.equal(p.price.amount, 1299);
  assert.equal(p.price.currency, "EUR");
  assert.equal(p.image, "https://craftco.example/images/organizer.jpg"); // absolutized
});

test("microdata extraction", () => {
  const { CF, document, window } = loadCF(fixture("microdata-product.html"));
  const p = CF.extractProduct(document, window.location);
  assert.equal(p.method, "microdata");
  assert.equal(p.title, "Cast Iron Skillet 12 inch");
  assert.equal(p.price.amount, 34.95);
  assert.equal(p.price.currency, "USD");
});

test("SPA shop with no structured data: heuristic path via -p- URL", () => {
  const { CF, document, window } = loadCF(fixture("spa-shop.html"), "https://m.shein.example/Frenchy-Pants-p-12345678.html");
  const p = CF.extractProduct(document, window.location);
  assert.equal(p.found, true);
  assert.equal(p.method, "heuristic");
  assert.equal(p.title, "Frenchy Solid Linen Wide Leg Pants");
  assert.equal(p.price.amount, 18.49);
  assert.equal(p.image, "https://img.example-cdn.com/images/pants-main.jpg"); // largest, not the icon
});

test("loose extraction always produces a best guess for explicit invocations", () => {
  const { CF, document, window } = loadCF(fixture("spa-shop.html"), "https://m.shein.example/weird/url/shape");
  assert.equal(CF.extractProduct(document, window.location).found, false, "strict mode stays conservative");
  const p = CF.extractProductLoose(document, window.location);
  assert.equal(p.found, true);
  assert.equal(p.method, "fallback");
  assert.equal(p.title, "Frenchy Solid Linen Wide Leg Pants");
  assert.equal(p.price.amount, 18.49);
});

test("non-product page yields found:false", () => {
  const { CF, document, window } = loadCF(fixture("no-product.html"), "https://blog.example/posts/typography");
  const p = CF.extractProduct(document, window.location);
  assert.equal(p.found, false);
});

test("price parsing edge cases", () => {
  const { CF } = loadCF("<html></html>");
  assert.equal(CF.parsePrice("$1,299.99").amount, 1299.99);
  assert.equal(CF.parsePrice("$1,299.99").currency, "USD");
  assert.equal(CF.parsePrice("1.299,99 €").amount, 1299.99);
  assert.equal(CF.parsePrice("1.299,99 €").currency, "EUR");
  assert.equal(CF.parsePrice("29,90").amount, 29.9);
  assert.equal(CF.parsePrice("1.299").amount, 1299); // European thousands
  assert.equal(CF.parsePrice("12.99").amount, 12.99);
  assert.equal(CF.parsePrice("USD 45").currency, "USD");
  assert.equal(CF.parsePrice("£9.50").currency, "GBP");
  assert.equal(CF.parsePrice(19.5).amount, 19.5);
  assert.equal(CF.parsePrice("1.234.567").amount, 1234567); // EU millions
  assert.equal(CF.parsePrice("1.234.56").amount, 1234.56);
  assert.equal(CF.parsePrice(""), null);
  assert.equal(CF.parsePrice("free"), null);
  assert.equal(CF.parsePrice("0"), null);
  assert.equal(CF.parsePrice(0), null); // JSON-LD "price": 0 placeholder
  assert.equal(CF.parsePrice(-5), null);
});

test("search query drops noise words and caps length", () => {
  const { CF } = loadCF("<html></html>");
  const q = CF.buildSearchQuery({
    title: "NEW 2025 Hot Sale Premium Ultra Portable Neck Fan 4000mAh Bladeless USB Rechargeable",
    brand: null
  });
  assert.ok(!/2025|hot|sale|premium/i.test(q), q);
  assert.ok(q.toLowerCase().includes("neck fan"));
  assert.ok(q.split(" ").length <= 8);
});

test("search query keeps non-ASCII titles and brands intact", () => {
  const { CF } = loadCF("<html></html>");
  const jp = CF.buildSearchQuery({ title: "ワイヤレスイヤホン Bluetooth 5.3 完全ワイヤレス", brand: null });
  assert.ok(jp.includes("ワイヤレスイヤホン"), jp);
  const fr = CF.buildSearchQuery({ title: "Étui de téléphone en cuir véritable", brand: null });
  assert.ok(fr.startsWith("Étui"), fr);
  // Brand containment is token-boundary aware: "Café" is already in the
  // query and must not be prepended again.
  const cafe = CF.buildSearchQuery({ title: "Café Crème Espresso Machine", brand: "Café" });
  assert.ok(!/Café.*Café/.test(cafe), cafe);
});

test("titleSimilarity behaves", () => {
  const { CF } = loadCF("<html></html>");
  const a = "Ultra Portable Neck Fan 4000mAh Bladeless";
  const close = CF.titleSimilarity(a, "Portable Bladeless Neck Fan, 4000mAh Battery Operated, USB Rechargeable Personal Fan");
  const far = CF.titleSimilarity(a, "Stainless Steel Garden Hose 50ft Expandable");
  assert.ok(close > 0.5, String(close));
  assert.ok(far < 0.2, String(far));
  // Short accessory titles must NOT be inflated (this is why similarity is
  // query-coverage, not min-overlap): a $3 case is not a cheaper iPhone.
  const accessory = CF.titleSimilarity("Apple iPhone 15 Pro Max 256GB Natural Titanium", "iphone 15 case");
  assert.ok(accessory < 0.5, String(accessory));
});

test("dropship heuristics on a Shopify/AliExpress-flavored page", () => {
  const { CF, document } = loadCF(fixture("shopify-product.html"));
  const a = CF.assessDropship(document, {});
  const ids = a.signals.map((s) => s.id);
  assert.ok(ids.includes("platform"), JSON.stringify(ids));
  assert.ok(ids.includes("apps"));
  assert.ok(ids.includes("cdn"));
  assert.ok(ids.includes("shipping"));
  assert.ok(ids.includes("urgency"));
  assert.ok(a.score >= 6);
  assert.equal(a.tone, "bad");
});

test("clean handmade shop scores low", () => {
  const { CF, document } = loadCF(fixture("og-product.html"));
  const a = CF.assessDropship(document, {});
  assert.ok(a.score < 3, JSON.stringify(a.signals));
  assert.equal(a.tone, "ok");
});

test("legit-shop phrasings do not trip signals", () => {
  const html = `<!doctype html><html><head><title>Shop</title>
    <script src="https://cdn.shopify.com/s/files/1/1/assets/theme.js"></script>
    <script src="https://cdn.example.com/loox-reviews.js"></script>
    <script src="https://cdn.example.com/aftership-tracking.js"></script>
    </head><body>
    <h1>Linen Shirt</h1>
    <p>Only 3 left in stock - order soon.</p>
    <p>Refunds are processed in 7-14 days after we receive the item.</p>
    <p>Free shipping on all orders, returns accepted within 14-30 days.</p>
    </body></html>`;
  const { CF, document } = loadCF(html);
  const a = CF.assessDropship(document, {});
  const ids = a.signals.map((s) => s.id);
  assert.ok(!ids.includes("apps"), "loox/aftership must not count as dropship apps: " + JSON.stringify(a.signals));
  assert.ok(!ids.includes("shipping"), "refund window is not a delivery estimate");
  assert.ok(!ids.includes("urgency"), "a plain stock counter is not an urgency widget");
  assert.equal(a.tone, "ok"); // only the +1 Shopify platform signal remains
});

test("domain age adds signal", () => {
  const { CF, document } = loadCF(fixture("og-product.html"));
  const a = CF.assessDropship(document, { domainAgeMonths: 3 });
  assert.ok(a.signals.some((s) => s.id === "domain-age"));
});
