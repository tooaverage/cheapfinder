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
  assert.equal(CF.parsePrice(""), null);
  assert.equal(CF.parsePrice("free"), null);
  assert.equal(CF.parsePrice("0"), null);
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

test("titleSimilarity behaves", () => {
  const { CF } = loadCF("<html></html>");
  const a = "Ultra Portable Neck Fan 4000mAh Bladeless";
  const close = CF.titleSimilarity(a, "Portable Bladeless Neck Fan, 4000mAh Battery Operated, USB Rechargeable Personal Fan");
  const far = CF.titleSimilarity(a, "Stainless Steel Garden Hose 50ft Expandable");
  assert.ok(close > 0.5, String(close));
  assert.ok(far < 0.2, String(far));
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

test("domain age adds signal", () => {
  const { CF, document } = loadCF(fixture("og-product.html"));
  const a = CF.assessDropship(document, { domainAgeMonths: 3 });
  assert.ok(a.signals.some((s) => s.id === "domain-age"));
});
