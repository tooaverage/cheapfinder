# Legitimate data sources for a public version

Research date: 2026-07-29. Facts in this space change fast; items marked ⚠️ changed
recently or are uncertain. The current extension is server-free: mostly search links,
plus a best-effort client-side fetch of public Amazon/eBay search pages (which IS
scraping-lite, is against their ToS, and is why it often falls back to links — fine for
personal use, not for distribution). This doc is the roadmap for doing it *properly* at
public scale.

## 1. How Google Lens / Google Shopping actually gets product + price data

Not by scraping Amazon. Google's pipeline is a hybrid of three mechanisms:

1. **Merchant-pushed feeds (primary).** Merchants voluntarily upload structured product
   feeds (title, GTIN, price, availability, image URL) to
   [Google Merchant Center](https://support.google.com/merchants/answer/7052112?hl=en) —
   for ads, and since 2020 for free listings too. This is the authoritative price source.
2. **On-page structured data (crawl-assisted).** Googlebot reads
   [schema.org `Product`/`Offer` markup](https://developers.google.com/search/docs/appearance/structured-data/product),
   which alone makes products eligible for the Shopping tab
   ([merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)).
   Google can crawl at scale because every shop *wants* Googlebot in — blocking it means
   disappearing from search. No extension developer can replicate that privileged position.
3. **Google Lens** matches the photo visually against Merchant Center feed images +
   crawled product pages, then displays the feed's price data.

Implication: Google's aggregate Shopping index has **no public read API** (the
Content/Merchant API only manages *your own* merchant feed). CheapFinder mimics
mechanism 2 client-side: it reads the same schema.org/OpenGraph markup on the page you
are already viewing — first-party data, no scraping.

## 2. How Honey / Capital One Shopping / Rakuten do it legally

**Affiliate networks and direct merchant partnerships**, not scraping:

- **Honey (PayPal)**: ~30k retailers across ~24 affiliate networks; coupons supplied by
  merchants via those networks; Honey earns the commission
  ([their explanation](https://help.joinhoney.com/article/30-how-does-honey-make-money)).
  Price tracking additionally uses data observed from its own users' browsing — the
  extension is a distributed data collector on pages users already view (legally
  distinct from server-side scraping, but requires prominent consent).
- **Capital One Shopping**: retailer partnerships + affiliate commissions + crowdsourced
  observation.
- **Rakuten** *is* an affiliate network — first-party access to merchant feeds.

The pattern to copy: **the affiliate contract is both the data license and the
monetization.** The APIs below are free precisely because they exist to drive
commissioned traffic.

## 3. Official APIs

| Source | What it offers | Requirements | Cost | Limits | Image search |
|---|---|---|---|---|---|
| **Amazon PA-API 5.0** | keyword search, ASIN lookup, prices, affiliate links | Associates account; **needs qualifying sales to keep access** (≥3 sales/180 days; cut after 30 days without sales ⚠️) | free | 1 TPS / 8,640 req/day, scales with revenue ([docs](https://webservices.amazon.com/paapi5/documentation/troubleshooting/api-rates.html)) | no |
| **eBay Browse API** | keyword/GTIN search, item details, EPN affiliate params | free [developer program](https://developer.ebay.com/api-docs/buy/browse/overview.html) | free | 5,000 calls/day default, raisable free | **yes** — `searchByImage` |
| **AliExpress Open Platform** | `aliexpress.affiliate.product.query`, details, link generation | AliExpress Portals affiliate + app approval | free | modest per-app quotas ⚠️ | **yes** — `aliexpress.affiliate.image.search` (permission-gated) |
| **Temu** | **no product API at all**; affiliate tracked links only (5–20% commission) | affiliate signup | — | — | no — treat Temu as link-out only |
| **Walmart Affiliate API** | [product lookup by UPC/GTIN](https://walmart.io/docs/affiliates/v1/product-lookup) (best exact-match source), search, trending | walmart.io + Impact.com publisher account | free | generous | no |
| **SERP vendors** (SerpApi, DataForSEO, Oxylabs) | scraped Google Shopping/Lens/retailer results incl. Temu | signup | SerpApi from free 250/mo, $25/1k | plan-based | yes (Lens endpoints) |

Legal posture of SERP vendors: gray zone — they breach target-site ToS and shift risk to
themselves (*hiQ v. LinkedIn* says public-data scraping isn't a CFAA violation; ⚠️
*Google v. SerpApi* filed Dec 2025, dismissed July 2026 for lack of standing, amended
complaint expected). Usable as an optional layer, not a foundation.

## 4. Reverse image search with an API

- **AliExpress `image.search`** (free, gated): returns AliExpress products with prices for
  an image — directly answers "is this shop reselling an AliExpress item?" ⭐ killer feature
- **eBay `searchByImage`** (free within quota)
- **Google Cloud Vision Web Detection** ($3.50/1k after 1k free/mo): similar images +
  hosting pages, no prices
- **TinEye API** (from $200/mo): exact-duplicate matching — great for proving a shop
  reuses AliExpress product photos
- **Bing Visual Search: retired Aug 2025** — do not build on it

## 5. Chrome Web Store rules (post-Honey-scandal)

Honey's sin was silent last-click affiliate hijacking at checkout. Since June 2025 the
[CWS affiliate-ads policy](https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads)
bans: injecting affiliate links/cookies **without explicit user action**, claiming
attribution with **no tangible user benefit at that moment**, and undisclosed affiliate
relationships. Allowed: affiliate links the user explicitly **clicks** ("Buy at Walmart —
$12.99") tied to a real benefit, with disclosure in the listing and UI. CheapFinder's
click-a-row-to-open model fits this cleanly. Also: single-purpose policy, minimal host
permissions, disclosed data collection.

## Recommended public architecture

```
product page (content script)
  → extract title / brand / GTIN / price / image from page markup (first-party)
  → backend:
      1. exact match by GTIN/UPC:  Walmart lookup, eBay Browse GTIN, PA-API GetItems
      2. keyword fallback:         PA-API SearchItems, eBay Browse, AliExpress product.query
      3. drop-ship detection:      image → AliExpress image.search (+ TinEye exact match)
                                   same image, much lower price ⇒ likely drop-shipped
      4. Temu:                     affiliate link-out only
      5. cache within each API's ToS (Amazon: ≤24h, show timestamps)
  → results as explicit "open at retailer" buttons carrying affiliate tags
```

Bootstrap notes:
- Amazon PA-API needs sales to stay alive → start with eBay + Walmart + AliExpress (no
  sales prerequisite), and/or support **user-provided API keys** in settings.
- Affiliate commissions (Amazon ~1–4%, eBay EPN, Walmart ~1–4%, AliExpress up to ~9%,
  Temu 5–20% links) are the monetization *and* the data license — same contract.
- Crowdsourced price observation (the Honey model) is possible later but needs prominent
  consent + GDPR/CCPA hygiene.
