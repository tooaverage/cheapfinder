import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* The shared modules attach themselves to globalThis.CheapFinder. Evaluate
 * them inside the jsdom window so `document` etc. resolve there. */
export function loadCF(html, url = "https://example-shop.com/products/widget") {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const { window } = dom;
  for (const file of [
    "extension/shared/extract.js",
    "extension/shared/heuristics.js",
    "extension/shared/sites.js",
    "extension/shared/ui.js"
  ]) {
    const src = readFileSync(join(root, file), "utf8");
    window.eval(src);
  }
  return { CF: window.CheapFinder, window, document: window.document };
}

export function fixture(name) {
  return readFileSync(join(root, "test/fixtures", name), "utf8");
}
