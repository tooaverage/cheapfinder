/* E2E: load the unpacked extension in real Chromium, open a fixture shop
 * page over http, and verify the popover renders. Also verifies the built
 * bookmarklet bundle in a plain page (no extension privileges).
 * Artifacts (screenshots) land in test/e2e/artifacts/. */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
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

// Use the full pre-installed Chromium (extensions don't run in the
// headless shell). Falls back to Playwright's own resolution if absent.
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: exe,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`
  ]
});

try {
  // ---- Extension on a dropship-flavored product page ----
  const page = await context.newPage();
  await page.goto(`${base}/shopify-product.html`, { waitUntil: "domcontentloaded" });
  const host = page.locator("[data-cheapfinder]");
  await host.waitFor({ state: "attached", timeout: 10000 });
  check("extension mounts popover host", true);

  const panelText = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return h && h.shadowRoot ? h.shadowRoot.textContent : null;
  });
  check("panel auto-opens with product title", /Ultra Portable Neck Fan/.test(panelText || ""), panelText || "null");
  check("panel shows page price", /\$49\.99/.test(panelText || ""));
  check("verdict flags dropshipping", /drop-shipped|drop-shipping/i.test(panelText || ""));

  const links = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return [...h.shadowRoot.querySelectorAll("a")].map((a) => a.href);
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
    return !h.shadowRoot.querySelector(".spin");
  });
  check("live lookups settle (results or fallback links)", spinnerGone);
  await page.screenshot({ path: join(artifacts, "extension-panel.png") });

  // Collapse to badge
  await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    h.shadowRoot.querySelector(".iconbtn").click();
  });
  const badgeVisible = await page.evaluate(() => {
    const h = document.querySelector("[data-cheapfinder]");
    return !!h.shadowRoot.querySelector(".badge");
  });
  check("close collapses to badge", badgeVisible);

  // ---- Non-product page: no popover ----
  const page2 = await context.newPage();
  await page2.goto(`${base}/no-product.html`, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(1500);
  const none = await page2.evaluate(() => !document.querySelector("[data-cheapfinder]"));
  check("no popover on non-product page", none);

  // ---- Bookmarklet bundle in a plain browser (no extension) ----
  const plain = await chromium.launch({ headless: true, executablePath: exe });
  const page3 = await plain.newPage();
  page3.on("dialog", (d) => { console.log("# bookmarklet dialog:", d.message()); d.dismiss(); });
  page3.on("pageerror", (e) => console.log("# bookmarklet pageerror:", String(e).slice(0, 300)));
  await page3.goto(`${base}/og-product.html`, { waitUntil: "domcontentloaded" });
  const bundle = readFileSync(join(root, "bookmarklet/cheapfinder.js"), "utf8");
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
  await plain.close();
} finally {
  await context.close();
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL E2E CHECKS PASSED");
process.exit(failures ? 1 : 0);
