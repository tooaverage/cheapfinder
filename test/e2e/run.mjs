/* E2E: load the unpacked extension in real Chromium, open a fixture shop
 * page over http, and verify the popover renders. Also verifies the built
 * bookmarklet bundle in a plain page (no extension privileges).
 * Artifacts (screenshots) land in test/e2e/artifacts/. */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = join(root, "test/e2e/artifacts");
mkdirSync(artifacts, { recursive: true });

const server = http.createServer((req, res) => {
  try {
    const name = req.url.split("?")[0].replace(/^\//, "") || "shopify-product.html";
    const body = readFileSync(join(root, "test/fixtures", name.replace(/[^a-z0-9.-]/gi, "")));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end("nope");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "ok" : "NOT OK"} - ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
}

const extPath = join(root, "extension");
const profile = join(artifacts, "profile");
rmSync(profile, { recursive: true, force: true });

// Extensions need full Chromium (the default headless shell can't load
// them). Preference order: $CHROMIUM_PATH, a preinstalled Playwright
// chromium, else Playwright's own resolution (`npx playwright install
// chromium` first on a fresh machine).
const preinstalled = "/opt/pw-browsers/chromium";
const exe =
  process.env.CHROMIUM_PATH || (existsSync(preinstalled) ? preinstalled : undefined);
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  ...(exe ? { executablePath: exe } : { channel: "chromium" }),
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`
  ]
});

let plain = null;
try {
  // The panel's shadow root is closed in production; flip the test-only
  // exposeShadow setting (via the extension's own popup page) so these
  // checks can read panel content.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.evaluate(() => new Promise((r) => chrome.storage.sync.set({ exposeShadow: true }, r)));
  await popup.close();

  // ---- Extension on a dropship-flavored product page ----
  const page = await context.newPage();
  await page.goto(`${base}/shopify-product.html`, { waitUntil: "domcontentloaded" });
  const mounted = await page
    .locator("[data-cheapfinder]")
    .waitFor({ state: "attached", timeout: 10000 })
    .then(() => true, () => false);
  check("extension mounts popover host", mounted);

  const panelText = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return h && h.shadowRoot ? h.shadowRoot.textContent : null;
  });
  check("panel auto-opens with product title", /Ultra Portable Neck Fan/.test(panelText || ""), panelText || "null");
  check("panel shows page price", /\$49\.99/.test(panelText || ""));
  check("verdict flags dropshipping", /drop-shipped|drop-shipping/i.test(panelText || ""));

  const links = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return h && h.shadowRoot ? [...h.shadowRoot.querySelectorAll("a")].map((a) => a.href) : [];
  });
  check("has AliExpress link", links.some((l) => l.includes("aliexpress.com")), JSON.stringify(links));
  check("has Temu link", links.some((l) => l.includes("temu.com")));
  check("has Google Lens by-image link", links.some((l) => l.includes("lens.google.com/uploadbyurl")));
  check("has Amazon link", links.some((l) => l.includes("amazon.com")));

  // Live lookups resolve (to results or graceful fallback) — no spinner forever.
  await page.waitForFunction(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return h && h.shadowRoot && !h.shadowRoot.querySelector(".spin");
  }, { timeout: 20000 }).catch(() => {});
  const spinnerGone = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return !!h && !h.shadowRoot.querySelector(".spin");
  });
  check("live lookups settle (results or fallback links)", spinnerGone);
  await page.screenshot({ path: join(artifacts, "extension-panel.png") });

  // Collapse to badge
  const badgeVisible = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    if (!h) return false;
    h.shadowRoot.querySelector(".iconbtn").click();
    return !!h.shadowRoot.querySelector(".badge");
  });
  check("close collapses to badge", badgeVisible);

  // ---- Non-product page: no popover ----
  const page2 = await context.newPage();
  await page2.goto(`${base}/no-product.html`, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(1500);
  const none = await page2.evaluate(() => !document.querySelector("[data-cheapfinder]"));
  check("no popover on non-product page", none);

  // ---- Bookmarklet in a plain browser (no extension) ----
  // Test the ENCODED javascript: URL from install.html — the exact bytes
  // users install — not the readable bundle.
  plain = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: "chromium" }) });
  const page3 = await plain.newPage();
  page3.on("dialog", (d) => { console.log("# bookmarklet dialog:", d.message()); d.dismiss(); });
  page3.on("pageerror", (e) => console.log("# bookmarklet pageerror:", String(e).slice(0, 300)));
  await page3.goto(`${base}/og-product.html`, { waitUntil: "domcontentloaded" });
  await page3.evaluate(() => { window.__CF_TEST_OPEN_SHADOW = true; });
  const installHtml = readFileSync(join(root, "bookmarklet/install.html"), "utf8");
  const hrefMatch = installHtml.match(/href="javascript:([^"]+)"/);
  check("install.html contains bookmarklet href", !!hrefMatch);
  const bundle = hrefMatch
    ? decodeURIComponent(hrefMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"))
    : "";
  await page3.evaluate(bundle).catch((e) => console.log("# bundle eval error:", String(e).slice(0, 400)));
  const bmText = await page3.evaluate(() => {
    const hosts = document.querySelectorAll("[data-cheapfinder]");
    const h = hosts[hosts.length - 1];
    return h && h.shadowRoot ? h.shadowRoot.textContent : null;
  });
  check("bookmarklet mounts panel with product", /Walnut Desk Organizer/.test(bmText || ""), bmText || "null");
  check("bookmarklet shows EUR page price", /€1299\.00/.test(bmText || ""), bmText || "");
  await page3.screenshot({ path: join(artifacts, "bookmarklet-panel.png") });

  // Second run removes the panel (toggle behavior)
  await page3.evaluate(bundle);
  const toggled = await page3.evaluate(() => !document.querySelector("[data-cheapfinder]"));
  check("second bookmarklet run dismisses panel", toggled);

  // SPA-style shop with zero structured data (the Shein case): the
  // bookmarklet must still mount via loose extraction.
  const page4 = await plain.newPage();
  await page4.goto(`${base}/spa-shop.html`, { waitUntil: "domcontentloaded" });
  await page4.evaluate(() => { window.__CF_TEST_OPEN_SHADOW = true; });
  await page4.evaluate(bundle).catch((e) => console.log("# spa bundle eval error:", String(e).slice(0, 400)));
  const spaText = await page4.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return h && h.shadowRoot ? h.shadowRoot.textContent : null;
  });
  check("bookmarklet handles SPA shop without structured data", /Frenchy Solid Linen/.test(spaText || ""), spaText || "null");
  check("SPA shop price detected from price-classed element", /\$18\.49/.test(spaText || ""));
} finally {
  if (plain) await plain.close().catch(() => {});
  await context.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL E2E CHECKS PASSED");
process.exit(failures ? 1 : 0);
