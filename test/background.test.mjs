import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./helpers.mjs";

/* background.js is a classic service-worker script; evaluate it globally
 * with importScripts/chrome stubbed so its function declarations land on
 * globalThis. */
before(() => {
  globalThis.importScripts = (...files) => {
    for (const f of files) (0, eval)(readFileSync(join(root, "extension", f), "utf8"));
  };
  globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
  (0, eval)(readFileSync(join(root, "extension/background.js"), "utf8"));
});

const amazonHtml = `
<div data-asin="B0TESTASIN" data-component-type="s-search-result" class="s-result-item">
  <h2 class="a-size-mini"><a href="/dp/B0TESTASIN"><span>Portable Neck Fan, Bladeless 4000mAh Rechargeable</span></a></h2>
  <span class="a-price"><span class="a-offscreen">$21.99</span></span>
</div>
<div data-asin="B0OTHERONE1" data-component-type="s-search-result" class="s-result-item">
  <h2><a href="/dp/B0OTHERONE1"><span>Garden Hose Expandable 50ft &amp; Nozzle</span></a></h2>
  <span class="a-price"><span class="a-offscreen">$12.49</span></span>
</div>`;

const ebayHtml = `
<li class="s-item"><div class="s-item__wrapper">
  <a href="https://www.ebay.com/itm/123456?hash=abc"><div class="s-item__title"><span>Neck Fan Portable Bladeless 4000mAh USB</span></div></a>
  <span class="s-item__price">$18.95</span>
</div></li>
<li class="s-item"><div class="s-item__wrapper">
  <a href="https://www.ebay.com/itm/1"><div class="s-item__title">Shop on eBay</div></a>
  <span class="s-item__price">$20.00</span>
</div></li>`;

test("parseAmazon extracts title, price, asin url", () => {
  const items = globalThis.parseAmazon(amazonHtml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Portable Neck Fan, Bladeless 4000mAh Rechargeable");
  assert.equal(items[0].priceAmount, 21.99);
  assert.equal(items[0].url, "https://www.amazon.com/dp/B0TESTASIN");
  assert.equal(items[1].title, "Garden Hose Expandable 50ft & Nozzle");
});

test("parseEbay extracts and skips placeholder card", () => {
  const items = globalThis.parseEbay(ebayHtml);
  assert.equal(items.length, 1);
  assert.equal(items[0].priceAmount, 18.95);
  assert.equal(items[0].url, "https://www.ebay.com/itm/123456");
});

test("rankResults filters dissimilar items and sorts by price", () => {
  const query = "portable neck fan 4000mah bladeless";
  const ranked = globalThis.rankResults(
    [...globalThis.parseAmazon(amazonHtml), ...globalThis.parseEbay(ebayHtml)],
    query
  );
  assert.ok(ranked.length >= 2);
  assert.ok(ranked.every((r) => !/garden hose/i.test(r.title)));
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].priceAmount <= ranked[i].priceAmount);
  }
});

test("decodeEntities handles named and numeric", () => {
  assert.equal(globalThis.decodeEntities("A &amp; B &#39;C&#x27; &lt;3"), "A & B 'C' <3");
});

test("registrableDomain strips subdomains, keeps two-part TLDs", () => {
  assert.equal(globalThis.registrableDomain("www.shop.example.com"), "example.com");
  assert.equal(globalThis.registrableDomain("shop.example.co.uk"), "example.co.uk");
  assert.equal(globalThis.registrableDomain("example.com"), "example.com");
});
