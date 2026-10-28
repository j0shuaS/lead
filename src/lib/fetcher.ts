import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';
import type { BrowserMode } from './types';

export const USER_AGENT =
  'LeadBot/1.0 (polite public-directory research crawler; honors robots.txt and request delays)';

const MAX_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Hard floor so a misconfigured delay can never hammer a site. */
export const MIN_DELAY_MS = 250;

export class FetchError extends Error {
  constructor(
    public code:
      | 'INVALID_URL'
      | 'BLOCKED'
      | 'ROBOTS'
      | 'HTTP'
      | 'NOT_HTML'
      | 'TIMEOUT'
      | 'NETWORK'
      | 'TOO_LARGE'
      | 'REDIRECTS'
      | 'NO_BROWSER'
      | 'ABORTED',
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return false;
  }
  return true;
}

/** Only public http(s) pages, no embedded credentials, no internal network addresses. */
export async function assertPublicUrl(u: URL, allowPrivate = false): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new FetchError('INVALID_URL', 'Only http:// and https:// URLs are supported.');
  }
  if (u.username || u.password) {
    throw new FetchError('INVALID_URL', 'URLs containing credentials are not allowed (public pages only).');
  }
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new FetchError('BLOCKED', 'Local and internal addresses cannot be scraped.');
  }
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try {
      addrs = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new FetchError('NETWORK', `Could not resolve host "${host}".`);
    }
  }
  if (addrs.some(isPrivateIp)) {
    throw new FetchError('BLOCKED', 'That address points to a private or internal network.');
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FetchError('ABORTED', 'Cancelled'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new FetchError('ABORTED', 'Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetcherOptions {
  delayMs: number;
  respectRobots: boolean;
  browser: BrowserMode;
  signal?: AbortSignal;
  allowPrivate?: boolean;
}

export interface FetchResult {
  html: string;
  finalUrl: string;
}

type RobotsEntry = { isAllowed(url: string, ua?: string): boolean | undefined; getCrawlDelay(ua?: string): number | undefined } | null;

/**
 * Sequential, throttled fetcher. One request at a time per host, a configurable
 * delay between requests, robots.txt support, retry/backoff on 429/503.
 */
export class PoliteFetcher {
  private lastHit = new Map<string, number>();
  private robots = new Map<string, RobotsEntry>();
  private browserPromise: Promise<any> | null = null;
  requests = 0;
  robotsBlocked = 0;

  constructor(private o: FetcherOptions) {}

  private get delay() {
    return Math.max(MIN_DELAY_MS, this.o.delayMs);
  }

  private async wait(host: string, extraMs = 0) {
    const delay = Math.max(this.delay, extraMs);
    const last = this.lastHit.get(host) ?? 0;
    const ms = last + delay - Date.now();
    if (ms > 0) await sleep(ms, this.o.signal);
    this.lastHit.set(host, Date.now());
  }

  private touch(host: string) {
    this.lastHit.set(host, Date.now());
  }

  private async rawFetch(startUrl: string): Promise<{ res: Response; finalUrl: string }> {
    let url = startUrl;
    for (let hop = 0; hop <= 5; hop++) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new FetchError('INVALID_URL', `Invalid URL: ${url}`);
      }
      await assertPublicUrl(u, this.o.allowPrivate);
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = this.o.signal ? AbortSignal.any([this.o.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.8',
          },
          redirect: 'manual',
          signal,
        });
      } catch (e: any) {
        if (this.o.signal?.aborted) throw new FetchError('ABORTED', 'Cancelled');
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
          throw new FetchError('TIMEOUT', 'The request timed out.');
        }
        throw new FetchError('NETWORK', `Network error: ${e?.cause?.code ?? e?.message ?? 'unknown'}`);
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.arrayBuffer().catch(() => undefined);
        url = new URL(loc, url).toString();
        continue;
      }
      return { res, finalUrl: url };
    }
    throw new FetchError('REDIRECTS', 'Too many redirects.');
  }

  private async getRobots(u: URL): Promise<RobotsEntry> {
    const key = u.origin;
    if (this.robots.has(key)) return this.robots.get(key)!;
    let entry: RobotsEntry = null;
    try {
      await this.wait(u.host);
      const { res } = await this.rawFetch(`${u.origin}/robots.txt`);
      this.requests++;
      if (res.status === 200) {
        const text = (await res.text()).slice(0, 500_000);
        entry = robotsParser(`${u.origin}/robots.txt`, text) as unknown as RobotsEntry;
      } else {
        await res.arrayBuffer().catch(() => undefined);
      }
      this.touch(u.host);
    } catch (e) {
      if (e instanceof FetchError && e.code === 'ABORTED') throw e;
      entry = null; // unreachable robots.txt -> treat as no rules, keep the normal delay
    }
    this.robots.set(key, entry);
    return entry;
  }

  /** Throws FetchError('ROBOTS') when disallowed; returns the extra crawl-delay in ms. */
  private async checkRobots(u: URL): Promise<number> {
    if (!this.o.respectRobots) return 0;
    const r = await this.getRobots(u);
    if (!r) return 0;
    if (r.isAllowed(u.toString(), USER_AGENT) === false) {
      this.robotsBlocked++;
      throw new FetchError('ROBOTS', 'Disallowed by the site\'s robots.txt.');
    }
    const cd = r.getCrawlDelay(USER_AGENT);
    return cd ? Math.min(cd * 1000, 30_000) : 0;
  }

  async get(urlStr: string): Promise<FetchResult> {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch {
      throw new FetchError('INVALID_URL', `Invalid URL: ${urlStr}`);
    }
    await assertPublicUrl(u, this.o.allowPrivate);
    const crawlDelay = await this.checkRobots(u);

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.wait(u.host, crawlDelay);
      this.requests++;
      let out: { res: Response; finalUrl: string };
      try {
        out = await this.rawFetch(urlStr);
      } catch (e) {
        if (e instanceof FetchError && (e.code === 'NETWORK' || e.code === 'TIMEOUT') && attempt < 1) {
          await sleep(2000, this.o.signal);
          continue;
        }
        throw e;
      }
      this.touch(u.host);
      const { res, finalUrl } = out;

      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const ra = Number(res.headers.get('retry-after'));
        const backoff = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5000 * (attempt + 1), 30_000);
        await res.arrayBuffer().catch(() => undefined);
        await sleep(backoff, this.o.signal);
        continue;
      }
      if (res.status >= 400) {
        await res.arrayBuffer().catch(() => undefined);
        throw new FetchError('HTTP', httpMessage(res.status), res.status);
      }
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct && !/html|xml|text\/plain/.test(ct)) {
        await res.arrayBuffer().catch(() => undefined);
        throw new FetchError('NOT_HTML', `Not an HTML page (${ct.split(';')[0]}).`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new FetchError('TOO_LARGE', 'Page is too large to process.');
      const charset = /charset=([\w-]+)/i.exec(ct)?.[1] ?? 'utf-8';
      let html: string;
      try {
        html = new TextDecoder(charset).decode(buf);
      } catch {
        html = new TextDecoder('utf-8').decode(buf);
      }
      return { html, finalUrl };
    }
    throw new FetchError('HTTP', 'The site kept rate-limiting requests.', 429);
  }

  // ---------- optional headless browser ----------

  private async getBrowser(): Promise<any> {
    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        let pw: any;
        try {
          // Indirect import so bundlers don't try to resolve the optional dependency.
          const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
          pw = await dynamicImport('playwright');
        } catch {
          throw new FetchError(
            'NO_BROWSER',
            'Headless browser unavailable. Run "npm install playwright" and "npx playwright install chromium".',
          );
        }
        try {
          return await (pw.chromium ?? pw.default?.chromium).launch({ headless: true });
        } catch (e: any) {
          throw new FetchError('NO_BROWSER', `Could not launch Chromium: ${String(e?.message ?? e).split('\n')[0]}`);
        }
      })();
      this.browserPromise.catch(() => undefined);
    }
    return this.browserPromise;
  }

  /** Render a page with a real browser (for JavaScript-driven directories). */
  async render(urlStr: string): Promise<FetchResult> {
    const u = new URL(urlStr);
    await assertPublicUrl(u, this.o.allowPrivate);
    const crawlDelay = await this.checkRobots(u);
    await this.wait(u.host, crawlDelay);
    this.requests++;
    const browser = await this.getBrowser();
    const ctx = await browser.newContext({ userAgent: USER_AGENT });
    try {
      const page = await ctx.newPage();
      await page.route('**/*', (route: any) => {
        const t = route.request().resourceType();
        return t === 'image' || t === 'media' || t === 'font' ? route.abort() : route.continue();
      });
      try {
        await page.goto(urlStr, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch (e: any) {
        if (!/Timeout/i.test(String(e?.message))) throw new FetchError('NETWORK', `Browser error: ${String(e?.message).split('\n')[0]}`);
      }
      // Trigger lazy-loaded / infinite-scroll content a few times.
      for (let i = 0; i < 5; i++) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await page.waitForTimeout(500);
      }
      const html: string = await page.content();
      this.touch(u.host);
      return { html, finalUrl: page.url() };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  async close() {
    if (this.browserPromise) {
      try {
        const b = await this.browserPromise;
        await b.close();
      } catch {
        /* ignore */
      }
      this.browserPromise = null;
    }
  }
}

function httpMessage(status: number): string {
  if (status === 401 || status === 403)
    return `Page is not publicly accessible (HTTP ${status}). It may require a login or block automated access.`;
  if (status === 404 || status === 410) return `Page not found (HTTP ${status}).`;
  if (status >= 500) return `The site returned a server error (HTTP ${status}).`;
  return `Request failed (HTTP ${status}).`;
}
