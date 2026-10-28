import { BusinessStore } from './dedupe';
import { NO_WEBSITE_PREFIXES } from './blocklist';
import { extractPage, normalizeUrl, sameRegistrableDomain, sameSite as sameHost, type PageExtract } from './extract';
import { FetchError, PoliteFetcher } from './fetcher';
import { isChamberUrl, matchesBlockedPrefix } from './places';
import type { Business, ScrapeEvent, ScrapeOptions, ScrapeStats } from './types';

interface QueueItem {
  url: string;
  kind: 'listing' | 'member';
  category?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  chambermaster: 'ChamberMaster / GrowthZone "list" directory',
  growthzone: 'GrowthZone directory',
  'schema.org': 'schema.org structured data (LocalBusiness / Organization)',
  generic: 'generic directory (searching for schema.org data and member links)',
};

const snapshot = (b: Business): Business => ({ ...b, categories: [...b.categories] });

/** Same directory site, including other subdomains of it (www.x.org / business.x.org). */
const sameSite = (a: string, b: string) => sameHost(a, b) || sameRegistrableDomain(a, b);

export function parseSeeds(raw: string[]): { valid: string[]; invalid: { input: string; reason: string }[] } {
  const valid: string[] = [];
  const invalid: { input: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const input of raw.map((s) => s.trim()).filter(Boolean)) {
    let candidate = input;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^[^/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(candidate)) {
        invalid.push({ input, reason: 'Only http:// and https:// URLs are supported.' });
        continue;
      }
      candidate = `https://${candidate}`;
    }
    let u: URL;
    try {
      u = new URL(candidate);
    } catch {
      invalid.push({ input, reason: 'Not a valid URL.' });
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      invalid.push({ input, reason: 'Only http:// and https:// URLs are supported.' });
      continue;
    }
    if (u.username || u.password) {
      invalid.push({ input, reason: 'URLs with embedded credentials are not allowed (public pages only).' });
      continue;
    }
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
      invalid.push({ input, reason: 'Not a valid web address.' });
      continue;
    }
    const norm = normalizeUrl(u.toString()) ?? u.toString();
    if (seen.has(norm)) continue;
    seen.add(norm);
    valid.push(norm);
  }
  return { valid, invalid };
}

/**
 * Crawl one or more public directory URLs and stream events as they happen.
 * Requests are strictly sequential with a configurable delay in between.
 */
export async function* crawl(
  opts: ScrapeOptions,
  signal?: AbortSignal,
  internal: { allowPrivate?: boolean } = {},
): AsyncGenerator<ScrapeEvent> {
  const started = Date.now();
  const store = new BusinessStore();
  const fetcher = new PoliteFetcher({
    delayMs: opts.delayMs,
    respectRobots: opts.respectRobots,
    browser: opts.browser,
    signal,
    allowPrivate: internal.allowPrivate,
  });
  const seen = new Set<string>();
  let pagesFetched = 0;
  let errors = 0;
  let stoppedBy: ScrapeStats['stoppedBy'] = 'complete';
  let browserWarned = false;

  const { valid, invalid } = parseSeeds(opts.urls);
  for (const bad of invalid) {
    errors++;
    yield { type: 'log', level: 'error', message: `Invalid URL "${bad.input}": ${bad.reason}` };
  }
  if (!valid.length) {
    yield { type: 'log', level: 'error', message: 'No valid directory URLs to scrape.' };
  }

  const progress = (queued: number): ScrapeEvent => ({
    type: 'progress',
    pagesFetched,
    queued,
    businesses: store.size,
    duplicates: store.duplicates,
  });

  try {
    seedLoop: for (const seed of valid) {
      if (signal?.aborted) break;
      yield { type: 'log', level: 'info', message: `Starting ${seed}`, url: seed };

      const listing: QueueItem[] = [{ url: seed, kind: 'listing' }];
      const members: QueueItem[] = [];
      seen.add(seed);
      let seedFirstPage = true;
      let seedBusinesses = 0;
      let consecutiveFailures = 0;
      let sawCategoryLinks = false;

      while (listing.length || members.length) {
        if (signal?.aborted) {
          stoppedBy = 'cancelled';
          break seedLoop;
        }
        if (pagesFetched >= opts.maxPages) {
          stoppedBy = 'max-pages';
          yield { type: 'log', level: 'warn', message: `Reached the page limit (${opts.maxPages}). Raise "Max pages" to continue.` };
          break seedLoop;
        }
        const capped = store.size >= opts.maxResults;
        const item = members.shift() ?? (capped ? undefined : listing.shift());
        if (!item) {
          if (capped) stoppedBy = 'max-results';
          break;
        }

        // ---- fetch ----
        let html: string;
        let finalUrl: string;
        let rendered = false;
        try {
          const res = opts.browser === 'always' ? await fetcher.render(item.url) : await fetcher.get(item.url);
          html = res.html;
          finalUrl = res.finalUrl;
          rendered = opts.browser === 'always';
        } catch (e) {
          const fe = e instanceof FetchError ? e : new FetchError('NETWORK', String((e as Error)?.message ?? e));
          if (fe.code === 'ABORTED') {
            stoppedBy = 'cancelled';
            break seedLoop;
          }
          if (fe.code === 'NO_BROWSER' && !browserWarned) {
            browserWarned = true;
          }
          if (fe.code === 'ROBOTS') {
            yield { type: 'log', level: 'warn', message: `Skipped (robots.txt disallows it): ${item.url}`, url: item.url };
          } else {
            errors++;
            consecutiveFailures++;
            yield { type: 'log', level: 'error', message: `${fe.message}`, url: item.url };
          }
          if (seedFirstPage && item.url === seed && fe.code !== 'ROBOTS') {
            yield { type: 'log', level: 'error', message: `Could not read the directory page, skipping this URL.`, url: seed };
            break;
          }
          if (consecutiveFailures >= 5) {
            errors++;
            yield { type: 'log', level: 'error', message: 'Too many consecutive failures; stopping this directory.', url: seed };
            break;
          }
          yield progress(listing.length + members.length);
          continue;
        }
        consecutiveFailures = 0;
        pagesFetched++;

        if (!sameSite(finalUrl, seed)) {
          yield { type: 'log', level: 'warn', message: `Redirected to another site, skipping: ${finalUrl}`, url: item.url };
          continue;
        }

        // ---- extract ----
        let ex: PageExtract = extractPage(html, finalUrl, opts.emailMode);
        const empty = (x: PageExtract) => !x.drafts.length && !x.memberLinks.length && !x.categoryLinks.length;
        if (opts.browser === 'auto' && !rendered && empty(ex)) {
          try {
            const r = await fetcher.render(item.url);
            const ex2 = extractPage(r.html, r.finalUrl, opts.emailMode);
            if (!empty(ex2)) {
              ex = ex2;
              yield { type: 'log', level: 'info', message: 'Page needed JavaScript; used the headless browser.', url: item.url };
            }
          } catch (e) {
            if (e instanceof FetchError && e.code === 'ABORTED') {
              stoppedBy = 'cancelled';
              break seedLoop;
            }
            if (!browserWarned) {
              browserWarned = true;
              yield { type: 'log', level: 'warn', message: (e as Error).message };
            }
          }
        }

        if (seedFirstPage) {
          seedFirstPage = false;
          yield { type: 'log', level: 'info', message: `Detected: ${PLATFORM_LABEL[ex.platform]}`, url: seed };
          if (empty(ex)) {
            errors++;
            yield {
              type: 'log',
              level: 'error',
              message:
                'Unsupported directory: found no members, categories or schema.org business data on this page. ' +
                'If the members load with JavaScript, set the headless browser option to "Auto" or "Always".',
              url: seed,
            };
            break;
          }
        }
        if (ex.categoryLinks.length) sawCategoryLinks = true;

        // ---- apply results ----
        if (item.kind === 'member') {
          const d = ex.drafts[0];
          if (d) {
            const r = store.upsert({ ...d, memberUrl: item.url }, { allowNew: false, countDuplicate: false });
            if (r?.changed) yield { type: 'business', business: snapshot(r.business) };
          }
        } else {
          for (const d of ex.drafts) {
            const draft = { ...d };
            if (item.category) draft.categories = [...(draft.categories ?? []), item.category];
            const r = store.upsert(draft, { allowNew: store.size < opts.maxResults });
            if (!r) continue;
            if (r.isNew) seedBusinesses++;
            if (r.isNew || r.changed) yield { type: 'business', business: snapshot(r.business) };
            const mu = r.business.memberUrl;
            if (opts.openMemberPages && mu && !seen.has(mu) && sameSite(mu, seed)) {
              seen.add(mu);
              members.push({ url: mu, kind: 'member' });
            }
          }

          // pagination keeps its category and goes to the front of the line
          const pages: QueueItem[] = [];
          for (const n of ex.nextLinks) {
            if (!seen.has(n) && sameSite(n, seed)) {
              seen.add(n);
              pages.push({ url: n, kind: 'listing', category: item.category });
            }
          }
          listing.unshift(...pages);

          if (opts.followCategories) {
            for (const c of ex.categoryLinks) {
              if (seen.has(c.url) || !sameSite(c.url, seed)) continue;
              seen.add(c.url);
              listing.push({ url: c.url, kind: 'listing', category: c.kind === 'alpha' ? undefined : c.text || undefined });
            }
          }
        }
        yield progress(listing.length + members.length);
      }

      if (signal?.aborted) break;
      if (seedBusinesses === 0 && !opts.followCategories && sawCategoryLinks) {
        yield {
          type: 'log',
          level: 'warn',
          message: 'That page only lists categories. Turn on "Follow category pages" to collect the members inside them.',
          url: seed,
        };
      } else if (seedBusinesses === 0 && !seenError(errors)) {
        yield { type: 'log', level: 'warn', message: 'No businesses were found for this URL.', url: seed };
      }
      yield { type: 'log', level: 'info', message: `Finished ${seed}: ${seedBusinesses} new business(es).`, url: seed };
    }
  } finally {
    await fetcher.close();
  }

  // A "website" that is really one of the chamber's own pages doesn't count: clear it so the
  // member is treated as having no website (and becomes eligible for the Google Maps check).
  const blocked = [...NO_WEBSITE_PREFIXES, ...(opts.extraPrefixes ?? [])];
  let cleared = 0;
  for (const b of store.all()) {
    if (b.website && (isChamberUrl(b.website, valid) || matchesBlockedPrefix(b.website, blocked))) {
      b.website = '';
      cleared++;
    }
  }
  if (cleared) {
    yield { type: 'log', level: 'info', message: `Ignored ${cleared} website link${cleared === 1 ? '' : 's'} that point at the chamber's own pages (counted as no website).` };
  }

  const businesses = store.finalize().map(snapshot);
  const stats: ScrapeStats = {
    pagesFetched,
    businesses: businesses.length,
    duplicatesMerged: store.duplicates,
    errors,
    robotsBlocked: fetcher.robotsBlocked,
    elapsedMs: Date.now() - started,
    stoppedBy: signal?.aborted ? 'cancelled' : stoppedBy,
  };
  yield { type: 'done', stats, businesses };
}

// Placeholder hook so "no businesses" isn't reported on top of an already-reported hard error.
function seenError(errors: number): boolean {
  return errors > 0;
}
