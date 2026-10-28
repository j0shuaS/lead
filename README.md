# lead.

Turn a public Chamber of Commerce member directory into a clean, filterable business dataset.

> **Status:** written without being able to install dependencies or run anything
> (the build environment blocked the npm registry). Run `npm install` then
> `npm run selftest` first. Expect to fix a few small type or selector issues.

## Google Maps key (optional, for the no-website check)

```bash
cp .env.example .env.local     # then set GOOGLE_MAPS_API_KEY
```

Enable **Places API (New)** and billing on the Google Cloud project. Each lookup is one billed Text
Search request; the "Max Google lookups" setting caps a run. The key stays on the server.

## Run it

```bash
npm install
npm run selftest        # end-to-end test against local fixture directories
npm run dev             # http://localhost:3000
```

Optional, for JavaScript-rendered directories:

```bash
npm run browser:install   # npx playwright install chromium
```

## What it does

- Accepts one or more public directory URLs (GrowthZone, ChamberMaster, or any page with
  schema.org `LocalBusiness` / `Organization` JSON-LD or microdata).
- Auto-detects the structure: JSON-LD and microdata first, then member-link "cards" for
  `/list/member/…`-style directories (heuristic, not tied to one chamber's HTML).
- Optionally follows category and pagination links on the same site and de-duplicates
  businesses found in several categories (same member page, or same name without conflicting
  zip/phone).
- Optionally opens each member page for fuller details.
- **No-website pipeline:** after the crawl, members with no website are sorted to the top and
  shown in a "No website" panel. Each one can be checked on Google Maps (Places API (New)):
  - Google lists a real website -> it's filled in and the member leaves the "No website" group.
  - Google lists no website -> marked **No website (confirmed on Google)**.
  - Google's link is only a Facebook/Instagram/Yelp/etc. page -> still no website (the social link is saved).
  - Google's link is the chamber's own site, or redirects to it -> still no website. The rule compares
    the first 15 characters of the URL (scheme and `www.` ignored) with the directory URL you entered,
    plus the same registrable domain, and follows up to 6 HTTP redirects from Google's link.
  - Members that can't be confidently matched (name AND address/phone) are marked *not found on Google*
    instead of guessing.
- **Three tabs:** *Scrape* (crawl a directory), *Google check* (import a CSV, or send over the scrape
  results, then verify the no-website members on Google Maps) and *Starred* (the businesses you
  starred with the ☆ column; saved in the browser). A crawl or check keeps running while you look at
  another tab.
- Streams results into a table with search, state/category filters and "must have …" chips
  (e.g. must have email). **CSV, Excel and JSON exports contain exactly the filtered rows,
  in the current sort order.**

Fields: name, email, street, city, state, postal code, phone, website, description,
categories, Facebook, Instagram, LinkedIn (company pages), X/Twitter, plus the directory page URL.

## Politeness and privacy

- One request at a time, configurable delay between requests (hard floor 250 ms).
- Honors robots.txt (toggle) including `Crawl-delay`; backs off on HTTP 429/503 and honors `Retry-After`.
- Identifies itself with a descriptive User-Agent. Public pages only: no logins, no cookies,
  URLs with credentials are rejected, loopback/private network addresses are blocked.
- Never stores contact or person names. Email: prefers the address the directory lists as the
  member's main contact, falls back to generic role addresses (info@, sales@ …). The
  "Generic only" setting restricts it further.
- Values repeated across many unrelated businesses (the chamber's own phone/socials, etc.)
  are treated as site chrome and removed.

You are responsible for complying with each site's terms and with laws that apply to your use
of the data (CAN-SPAM, CASL, GDPR, …).

## Layout

```
src/lib/fetcher.ts   polite fetcher: throttle, robots, retries, SSRF guard, optional Playwright
src/lib/extract.ts   page parsing: JSON-LD, microdata, member cards, links, address/phone/email
src/lib/dedupe.ts    merging and final clean-up
src/lib/places.ts    Google Places lookup, name/address matching, chamber-URL rule
src/app/api/verify   streams the Google check
src/lib/crawler.ts   queue, categories, pagination, member pages; streams events
src/app/api/scrape   NDJSON streaming endpoint      src/app/api/export   .xlsx builder
src/app/page.tsx     tab shell + stars (localStorage)
src/components/      ScrapeTab, GoogleTab, StarredTab, LedgerTable, NoWebsitePanel, LogView
src/lib/csv.ts       CSV import (loose headers) / exporters.ts CSV, JSON, Excel export
scripts/             fixture server + self-test
```

## Known limits

- GrowthZone/ChamberMaster URL patterns are based on common `/list/member/…` and
  `/list/ql/…` layouts; unusual customizations may need a pattern added in `extract.ts`.
- Directories that require a search submission (form POST) before showing members aren't supported.
- "Confirmed" means Google lists the business with no website. It can't prove a site exists nowhere.
  Redirects are followed at the HTTP level only (not JavaScript or meta-refresh redirects).
- Social links come from each member's own card/page; links in site headers and footers are ignored.
