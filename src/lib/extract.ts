import * as cheerio from 'cheerio';
import type { BizDraft, EmailMode } from './types';

type $ = cheerio.CheerioAPI;
type El = cheerio.Cheerio<any>;

export type Platform = 'chambermaster' | 'growthzone' | 'schema.org' | 'generic';

export interface LinkInfo {
  url: string;
  text: string;
  kind?: 'category' | 'alpha';
}

export interface PageExtract {
  platform: Platform;
  isDetail: boolean;
  drafts: BizDraft[];
  memberLinks: LinkInfo[];
  categoryLinks: LinkInfo[];
  nextLinks: string[];
  title: string;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      u.searchParams.delete(k);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return null;
  }
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

export function sameSite(a: string, b: string): boolean {
  try {
    return bareHost(new URL(a).hostname) === bareHost(new URL(b).hostname);
  } catch {
    return false;
  }
}

const TWO_PART_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;

/** "business.montgomerycc.org" -> "montgomerycc.org" ('' for IPs / single-label hosts). */
export function registrableDomain(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes('.')) return '';
    return h.split('.').slice(-(TWO_PART_TLD.test(h) ? 3 : 2)).join('.');
  } catch {
    return '';
  }
}

/** Same organisation's domain, even across subdomains (www.x.org vs business.x.org). */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const x = registrableDomain(a);
  return !!x && x === registrableDomain(b);
}

/** The directory platform's own pages (GrowthZone / ChamberMaster "list" URLs). */
const DIRECTORY_PAGE = /\/list\/(member|ql|category|searchalpha)\//i;

/**
 * A link that belongs to the chamber's directory (same site, another subdomain of it, or a
 * /list/member|ql/ page on any host) is never the business's own website.
 */
export function isOwnSite(abs: string, pageUrl: string): boolean {
  return sameSite(abs, pageUrl) || sameRegistrableDomain(abs, pageUrl) || DIRECTORY_PAGE.test(abs);
}

function str(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return clean(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === 'object') return str(v['@value'] ?? v.name ?? '');
  return '';
}

/* ------------------------------------------------------------------ */
/* URL pattern classification                                          */
/* ------------------------------------------------------------------ */

const MEMBER_PATH: RegExp[] = [
  /\/list\/member\/[^/?#]+/i, // ChamberMaster / GrowthZone "list" sites
  /\/(?:directory|member-?directory|members?|business-?directory|business-?listings?|listings?)\/(?:details?|profile|member|business|view)\/[^/?#]+/i,
  /\/(?:members?|businesses|business|listings?)\/[a-z0-9-]*\d+[a-z0-9-]*(?:$|[/?#])/i,
];

const CATEGORY_PATH: RegExp[] = [
  /\/list\/ql\//i,
  /\/list\/category\//i,
  /\/(?:directory|member-?directory|business-?directory)\/(?:find|search|category|categories|browse)\b/i,
  /\/(?:member-?|business-?)?categor(?:y|ies)\/[^/?#]+/i,
  /[?&](?:cat|catid|category|categoryid|cid)=/i,
];
const ALPHA_PATH = /\/list\/searchalpha\//i;

const isMemberUrl = (u: string) => MEMBER_PATH.some((r) => r.test(u));
const isAlphaUrl = (u: string) => ALPHA_PATH.test(u);
const isCategoryUrl = (u: string) => CATEGORY_PATH.some((r) => r.test(u)) || isAlphaUrl(u);

function detectPlatform(html: string, url: string): Platform {
  if (/chambermaster/i.test(html) || /\/list\/(member|ql|searchalpha)\//i.test(html)) return 'chambermaster';
  if (/growthzone|micronet/i.test(html) || /growthzone/i.test(url)) return 'growthzone';
  if (/application\/ld\+json/i.test(html) && /LocalBusiness|"Organization"/i.test(html)) return 'schema.org';
  return 'generic';
}

/* ------------------------------------------------------------------ */
/* social / website classification                                     */
/* ------------------------------------------------------------------ */

export type SocialKind = 'facebook' | 'instagram' | 'linkedin' | 'twitter';

export function classifySocial(raw: string): { kind: SocialKind; url: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase().replace(/^(www|m|mobile|web|mbasic)\./, '');
  const p = u.pathname.replace(/\/+$/, '');
  if (!p) return null;
  const keep = () => `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;

  if (h === 'facebook.com' || h === 'fb.com' || h === 'fb.me') {
    if (/^\/(sharer|share|dialog|plugins|tr|login|policies|help|events|hashtag)\b/i.test(p)) return null;
    if (/^\/profile\.php$/i.test(p) && u.searchParams.get('id')) {
      return { kind: 'facebook', url: `https://www.facebook.com/profile.php?id=${u.searchParams.get('id')}` };
    }
    return { kind: 'facebook', url: keep() };
  }
  if (h === 'instagram.com') {
    if (/^\/(p|reel|reels|explore|accounts|stories|tv)\b/i.test(p)) return null;
    return { kind: 'instagram', url: keep() };
  }
  if (h === 'linkedin.com' || h.endsWith('.linkedin.com')) {
    if (/^\/(company|school)\/[^/]+/i.test(p)) return { kind: 'linkedin', url: keep() };
    return null;
  }
  if (h === 'twitter.com' || h === 'x.com') {
    if (/^\/(intent|share|home|search|hashtag|i|login|signup)\b/i.test(p)) return null;
    return { kind: 'twitter', url: keep() };
  }
  return null;
}

const BLOCKED_WEBSITE_HOSTS =
  /(^|\.)(google\.[a-z.]+|goo\.gl|bing\.com|apple\.com|waze\.com|mapquest\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.com|yelp\.com|addthis\.com|sharethis\.com|schema\.org|w3\.org|paypal\.com|growthzone\.com|growthzoneapp\.com|chambermaster\.com|micronetonline\.com|yourmembership\.com|wa\.me|whatsapp\.com|linktr\.ee|adobe\.com|cloudflare\.com)$/i;

/* ------------------------------------------------------------------ */
/* email / phone / address parsing                                     */
/* ------------------------------------------------------------------ */

const GENERIC_LOCALPARTS = new Set(
  [
    'info', 'contact', 'office', 'hello', 'sales', 'support', 'admin', 'service', 'services', 'mail',
    'enquiries', 'inquiries', 'inquiry', 'enquiry', 'customerservice', 'team', 'general', 'frontdesk',
    'reception', 'hr', 'marketing', 'booking', 'bookings', 'orders', 'billing', 'accounts', 'help',
    'webmaster', 'reservations', 'questions', 'staff', 'store', 'shop', 'media', 'press', 'careers',
  ],
);

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

function validEmail(e: string): boolean {
  const s = e.toLowerCase();
  if (s.length > 120) return false;
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(s)) return false;
  if (/@(example\.|sentry|wixpress|domain\.com|email\.com$|yourdomain|test\.com)/.test(s)) return false;
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s);
}

export function isGenericEmail(e: string): boolean {
  const local = e.toLowerCase().split('@')[0].replace(/[._-]/g, '');
  return GENERIC_LOCALPARTS.has(local);
}

/**
 * Prefer the address the directory presents as the member's main contact
 * (a named mailbox), then fall back to a generic role mailbox like info@.
 */
export function chooseEmail(cands: string[], mode: EmailMode, websiteHost = ''): string {
  const uniq = [...new Set(cands.map((c) => c.toLowerCase()).filter(validEmail))];
  const generic = uniq.filter(isGenericEmail);
  const named = uniq.filter((e) => !isGenericEmail(e));
  const onDomain = (list: string[]) =>
    websiteHost ? list.find((e) => bareHost(e.split('@')[1]).endsWith(bareHost(websiteHost).replace(/^www\./, ''))) : undefined;
  if (mode === 'generic-only') return onDomain(generic) ?? generic[0] ?? '';
  return onDomain(named) ?? named[0] ?? onDomain(generic) ?? generic[0] ?? '';
}

function decodeCfEmail(hex: string): string {
  try {
    const r = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ r);
    return out;
  } catch {
    return '';
  }
}

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g;

function firstPhone(text: string): string {
  PHONE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_RE.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 10), m.index).toLowerCase();
    if (/fax|f:/.test(before)) continue;
    return clean(m[0]);
  }
  return '';
}

const REGION_OK = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI ' +
    'AB BC MB NB NL NS NT NU ON PE QC SK YT').split(' '),
);
const ZIP = String.raw`(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)`;
const CSZ_LINE = new RegExp(String.raw`^([A-Za-z][A-Za-z .'\-]{1,40}?),?\s+([A-Z]{2})\.?\s+${ZIP}(?:\s*(?:USA|US|United States))?$`);
const ONE_LINE = new RegExp(
  String.raw`(\d[^\n]{2,80}?|P\.?\s?O\.?\s*Box\s*\w+),\s*([A-Za-z][A-Za-z .'\-]{1,40}?),?\s+([A-Z]{2})\.?\s+${ZIP}`,
);

interface Addr {
  street: string;
  city: string;
  region: string;
  postalCode: string;
}

export function parseAddressLines(lines: string[]): Addr | null {
  for (const line of lines) {
    const m = ONE_LINE.exec(line);
    if (m && REGION_OK.has(m[3])) {
      return { street: clean(m[1]), city: clean(m[2]), region: m[3], postalCode: m[4] };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const m = CSZ_LINE.exec(lines[i]);
    if (m && REGION_OK.has(m[2])) {
      let street = '';
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
        const l = lines[j];
        if (/^\d|^P\.?\s?O\.?\s*Box|^(suite|ste|unit|#|floor|fl)\b/i.test(l)) street = street ? `${l}, ${street}` : l;
        else break;
      }
      return { street, city: clean(m[1]), region: m[2], postalCode: m[3] };
    }
  }
  return null;
}

function textLines($: $, el: El): string[] {
  const c = el.clone();
  c.find('br').replaceWith('\n');
  c.find('p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,address,section,article,dt,dd').each((_, n) => {
    $(n).append('\n');
  });
  c.find('span,a,strong,b,em,label').each((_, n) => {
    $(n).append(' ');
  });
  return c
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* JSON-LD and microdata                                               */
/* ------------------------------------------------------------------ */

const BIZ_TYPE =
  /(LocalBusiness|Organization|Corporation|Store|Restaurant|Establishment|Business|Dentist|Attorney|Physician|Hotel|Motel|Bakery|BarOrPub|CafeOrCoffeeShop|Brewery|Winery|Pharmacy|GymOrHealthClub|Salon|Spa|RealEstateAgent|Contractor|Plumber|Electrician|Locksmith|Clinic|Hospital|School|Library|Museum|Notary|Florist|Optician|Veterinary|Church|Service)/i;
const NOT_BIZ_TYPE = /^(Person|WebSite|WebPage|Event|Article|BreadcrumbList|ListItem|ItemList|SearchAction|ImageObject|Product|Offer)$/i;

function walkLd(n: any, out: any[], depth = 0) {
  if (!n || typeof n !== 'object' || depth > 6) return;
  if (Array.isArray(n)) {
    n.forEach((x) => walkLd(x, out, depth + 1));
    return;
  }
  out.push(n);
  for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'hasPart']) {
    if (n[k] && typeof n[k] === 'object') walkLd(n[k], out, depth + 1);
  }
}

function readJsonLd($: $): any[] {
  const out: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).contents().text() || $(el).html() || '').trim();
    if (!raw) return;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      try {
        data = JSON.parse(
          raw
            .replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')
            .replace(/,\s*([}\]])/g, '$1'),
        );
      } catch {
        return;
      }
    }
    walkLd(data, out);
  });
  return out;
}

function ldToDraft(node: any, pageUrl: string): BizDraft | null {
  const types: string[] = ([] as any[]).concat(node['@type'] ?? []).map(String);
  if (!types.length || types.some((t) => NOT_BIZ_TYPE.test(t)) || !types.some((t) => BIZ_TYPE.test(t))) return null;
  const name = str(node.name);
  if (!name) return null;

  const d: BizDraft = { name };
  d._orgOnly = types.every((t) => /^(Organization|Corporation|NGO)$/i.test(t));

  const a = Array.isArray(node.address) ? node.address[0] : node.address;
  if (a && typeof a === 'object') {
    d.street = str(a.streetAddress);
    d.city = str(a.addressLocality);
    d.region = str(a.addressRegion);
    d.postalCode = str(a.postalCode);
  } else if (typeof a === 'string') {
    const p = parseAddressLines([clean(a)]);
    if (p) Object.assign(d, p);
  }

  const cps = ([] as any[]).concat(node.contactPoint ?? []);
  d.phone = str(node.telephone) || str(cps.map((c) => c?.telephone).find(Boolean));
  const email = str(node.email) || str(cps.map((c) => c?.email).find(Boolean));
  if (email) d.email = email.replace(/^mailto:/i, '');

  const url = str(node.url);
  if (url) {
    const abs = normalizeUrl(url, pageUrl);
    if (abs) {
      if (isOwnSite(abs, pageUrl)) d.memberUrl = abs;
      else d.website = abs;
    }
  }
  for (const s of ([] as any[]).concat(node.sameAs ?? [])) {
    const soc = typeof s === 'string' ? classifySocial(s) : null;
    if (soc) d[soc.kind] = soc.url;
  }
  const desc = str(node.description);
  if (desc) d.description = desc.slice(0, 500);
  const cats = ([] as any[])
    .concat(node.category ?? [])
    .map(str)
    .filter((c) => c && !/^https?:/i.test(c));
  if (cats.length) d.categories = cats;
  return d;
}

function readMicrodata($: $, pageUrl: string): BizDraft[] {
  const out: BizDraft[] = [];
  const bizEls = $('[itemscope][itemtype]').filter((_, el) => {
    const t = $(el).attr('itemtype') ?? '';
    return BIZ_TYPE.test(t) && !/PostalAddress|Person|WebSite|WebPage/i.test(t);
  });
  bizEls.each((_, el) => {
    const $el = $(el);
    if ($el.parents('[itemscope][itemtype]').filter((__, p) => BIZ_TYPE.test($(p).attr('itemtype') ?? '')).length) return;
    const prop = (name: string): string => {
      const found = $el
        .find(`[itemprop~="${name}"]`)
        .filter((__, x) => !$(x).closest('[itemtype*="Person"]').length)
        .first();
      if (!found.length) return '';
      const tag = (found.get(0) as any)?.tagName?.toLowerCase();
      if (tag === 'meta') return clean(found.attr('content'));
      if (tag === 'a' || tag === 'link') return clean(found.attr('href'));
      if (tag === 'time') return clean(found.attr('datetime') ?? found.text());
      return clean(found.text());
    };
    const name = prop('name');
    if (!name) return;
    const d: BizDraft = { name };
    d.street = prop('streetAddress');
    d.city = prop('addressLocality');
    d.region = prop('addressRegion');
    d.postalCode = prop('postalCode');
    d.phone = prop('telephone');
    const email = prop('email');
    if (email) d.email = email.replace(/^mailto:/i, '');
    d.description = prop('description').slice(0, 500);
    const url = prop('url');
    if (url) {
      const abs = normalizeUrl(url, pageUrl);
      if (abs) {
        if (isOwnSite(abs, pageUrl)) d.memberUrl = abs;
        else d.website = abs;
      }
    }
    out.push(d);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* heuristic extraction from an HTML scope (card or detail page)       */
/* ------------------------------------------------------------------ */

interface ContactResult {
  emails: string[];
  phone: string;
  addr: Addr | null;
  website: string;
  socials: Partial<Record<SocialKind, string>>;
}

function readContact($: $, scope: El, pageUrl: string): ContactResult {
  const emails: string[] = [];
  scope.find('a[href^="mailto:" i]').each((_, a) => {
    const e = decodeURIComponent(($(a).attr('href') ?? '').replace(/^mailto:/i, '').split('?')[0]).trim();
    if (e) emails.push(e);
  });
  scope.find('[data-cfemail]').each((_, n) => {
    const e = decodeCfEmail($(n).attr('data-cfemail') ?? '');
    if (e) emails.push(e);
  });
  scope.find('[itemprop="email"]').each((_, n) => {
    emails.push(clean($(n).attr('content') ?? $(n).text()).replace(/^mailto:/i, ''));
  });
  const lines = textLines($, scope);
  const text = lines.join('\n');
  (text.match(EMAIL_RE) ?? []).forEach((e) => emails.push(e));

  // phone
  let phone = '';
  const tel = scope.find('a[href^="tel:" i]').first().attr('href');
  if (tel) phone = clean(decodeURIComponent(tel.replace(/^tel:/i, '')));
  if (!phone) phone = clean(scope.find('[itemprop="telephone"]').first().text());
  if (!phone) phone = firstPhone(text);

  // address: microdata first, then text patterns
  let addr: Addr | null = null;
  const ma = scope.find('[itemprop="address"], [itemtype*="PostalAddress"]').first();
  if (ma.length) {
    const g = (n: string) => clean(ma.find(`[itemprop="${n}"]`).first().text());
    const m = { street: g('streetAddress'), city: g('addressLocality'), region: g('addressRegion'), postalCode: g('postalCode') };
    if (m.city || m.street) addr = m;
    else addr = parseAddressLines(textLines($, ma));
  }
  if (!addr) {
    const addrEl = scope.find('address, [class*="address" i]').first();
    if (addrEl.length) addr = parseAddressLines(textLines($, addrEl));
  }
  if (!addr) addr = parseAddressLines(lines);

  // website + socials
  let website = '';
  let bestScore = 0;
  const socials: Partial<Record<SocialKind, string>> = {};
  scope.find('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const abs = normalizeUrl(href, pageUrl);
    if (!abs) return;
    const soc = classifySocial(abs);
    if (soc) {
      if (!socials[soc.kind]) socials[soc.kind] = soc.url;
      return;
    }
    if (isOwnSite(abs, pageUrl)) return; // chamber pages (incl. other subdomains) are never the business's site
    let host = '';
    try {
      host = new URL(abs).hostname;
    } catch {
      return;
    }
    if (BLOCKED_WEBSITE_HOSTS.test(host)) return;
    if (/\.(pdf|docx?|xlsx?|jpg|png|zip)$/i.test(new URL(abs).pathname)) return;
    const text = clean($(a).text());
    let score = 10;
    if ($(a).attr('itemprop') === 'url') score = 100;
    else if (/website|visit|www\.|https?:\/\//i.test(text) || /website|visit/i.test($(a).attr('title') ?? '')) score = 50;
    if (score > bestScore) {
      bestScore = score;
      website = `${new URL(abs).origin}${new URL(abs).pathname === '/' ? '' : new URL(abs).pathname.replace(/\/+$/, '')}${new URL(abs).search}`;
    }
  });
  return { emails, phone, addr, website, socials };
}

function removeChrome($: $) {
  $('script,style,noscript,template,svg,iframe,form[role="search"]').remove();
  $('nav,[role="navigation"],[role="banner"],[role="contentinfo"],#footer,.footer,.site-footer,#header,.site-header,.cookie-banner').remove();
  $('header,footer')
    .filter((_, el) => !$(el).closest('article,li,[class*="card" i],[class*="member" i],[class*="listing" i]').length)
    .remove();
}

function bestLinkText($: $, scope: El, href: string, pageUrl: string): string {
  let best = '';
  scope.find('a[href]').each((_, a) => {
    const abs = normalizeUrl($(a).attr('href') ?? '', pageUrl);
    if (abs !== href) return;
    const t = clean($(a).text()) || clean($(a).attr('title')) || clean($(a).find('img').attr('alt'));
    if (/^(more|view|details?|read more|learn more|visit|website|view details|more info(rmation)?)\b/i.test(t)) return;
    if (t.length > best.length && t.length < 160) best = t;
  });
  return best;
}

function draftFromScope(
  $: $,
  scope: El,
  pageUrl: string,
  emailMode: EmailMode,
  opts: { name?: string; memberUrl?: string; detail: boolean },
): BizDraft {
  const c = readContact($, scope, pageUrl);
  const d: BizDraft = {};
  d.name = opts.name || clean(scope.find('h1,h2,h3,h4').first().text());
  if (opts.memberUrl) d.memberUrl = opts.memberUrl;
  if (c.addr) Object.assign(d, c.addr);
  d.phone = c.phone;
  d.website = c.website;
  d.email = chooseEmail(c.emails, emailMode, c.website ? new URL(c.website).hostname : '');
  Object.assign(d, c.socials);

  const descEl = scope.find('[itemprop="description"], [class*="description" i], [class*="about" i]').first();
  const desc = clean(descEl.text());
  if (desc.length > 20) d.description = desc.slice(0, 500);

  const cats = new Set<string>();
  scope.find('[itemprop="category"], [class*="categor" i] a, [class*="categor" i] li').each((_, n) => {
    const t = clean($(n).text());
    if (t && t.length < 80) cats.add(t);
  });
  scope.find('a[href]').each((_, a) => {
    const abs = normalizeUrl($(a).attr('href') ?? '', pageUrl);
    if (abs && isCategoryUrl(abs) && !isAlphaUrl(abs)) {
      const t = clean($(a).text()).replace(/\s*\(\d+\)\s*$/, '');
      if (t && t.length < 80) cats.add(t);
    }
  });
  if (cats.size) d.categories = [...cats];
  return d;
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractPage(html: string, pageUrl: string, emailMode: EmailMode): PageExtract {
  const $ = cheerio.load(html);
  const platform = detectPlatform(html, pageUrl);
  const title = clean($('title').first().text());
  const isDetail = isMemberUrl(pageUrl);

  const baseHref = $('base[href]').attr('href');
  const base = (baseHref && normalizeUrl(baseHref, pageUrl)) || pageUrl;

  // structured data first (scripts are stripped afterwards)
  const ld = readJsonLd($)
    .map((n) => ldToDraft(n, pageUrl))
    .filter((d): d is BizDraft => !!d);
  const micro = readMicrodata($, pageUrl);
  const orgOnlyCount = ld.filter((d) => d._orgOnly).length;
  const origin = new URL(pageUrl).origin;

  const structured = [...ld, ...micro].filter((d) => {
    if (!d.name) return false;
    if (!(d.street || d.city || d.phone || d.email || d.website || d.memberUrl)) return false;
    if (d._orgOnly && !d.memberUrl && !isDetail && orgOnlyCount < 2) return false; // likely the chamber itself
    if (d.website && !isDetail) {
      try {
        const w = new URL(d.website);
        if (w.pathname === '/' && sameSite(w.origin, origin)) return false;
      } catch {
        /* ignore */
      }
    }
    return true;
  });

  // links
  removeChrome($);
  const memberMap = new Map<string, LinkInfo>();
  const catMap = new Map<string, LinkInfo>();
  const nextLinks = new Set<string>();
  const pageNorm = normalizeUrl(pageUrl) ?? pageUrl;
  let pagePath = '';
  try {
    pagePath = new URL(pageUrl).pathname;
  } catch {
    /* ignore */
  }

  $('link[rel="next"][href], a[rel~="next"][href]').each((_, el) => {
    const u = normalizeUrl($(el).attr('href') ?? '', base);
    if (u && u !== pageNorm) nextLinks.add(u);
  });

  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (/^(mailto|tel|javascript|sms):/i.test(href) || href.startsWith('#')) return;
    const u = normalizeUrl(href, base);
    if (!u || u === pageNorm) return;
    const text = clean($(a).text()) || clean($(a).attr('title')) || clean($(a).find('img').attr('alt'));
    if (isMemberUrl(u)) {
      const prev = memberMap.get(u);
      if (!prev || text.length > prev.text.length) memberMap.set(u, { url: u, text });
      return;
    }
    if (isCategoryUrl(u)) {
      const t = text.replace(/\s*\(\d+\)\s*$/, '');
      if (!catMap.has(u)) catMap.set(u, { url: u, text: t, kind: isAlphaUrl(u) ? 'alpha' : 'category' });
      return;
    }
    // pagination: same path with a page parameter, or "next" style text
    try {
      const pu = new URL(u);
      const pageParam = /[?&](page|pg|p|pageno|pagenum|pagenumber|start|offset)=\d+/i.test(pu.search) || /\/page\/\d+\/?$/i.test(pu.pathname);
      if (pageParam && (pu.pathname === pagePath || /\/page\/\d+/.test(pu.pathname))) nextLinks.add(u);
      else if (/^(next|next page|next ›|›|»|>|>>|more results)$/i.test(text) && pu.pathname === pagePath) nextLinks.add(u);
    } catch {
      /* ignore */
    }
  });

  const drafts: BizDraft[] = [];

  if (isDetail) {
    // Detail page: a single business.
    const $scope = $('main, [role="main"], #content, .content, article').first();
    const scope = $scope.length ? $scope : $('body');
    const h1 = clean($('h1').first().text());
    const og = clean($('meta[property="og:title"]').attr('content')).split(/\s[|\-–—]\s/)[0];
    const heading = h1 || og || title.split(/\s[|\-–—]\s/)[0];

    let pick: BizDraft | undefined;
    if (structured.length) {
      const hn = norm(heading);
      pick =
        structured.find((d) => hn && norm(d.name ?? '') === hn) ??
        structured.find((d) => hn && (norm(d.name ?? '').includes(hn) || hn.includes(norm(d.name ?? '')))) ??
        structured.find((d) => !d._orgOnly) ??
        (structured.length === 1 ? structured[0] : undefined);
    }
    const heur = draftFromScope($, scope, base, emailMode, { name: heading, memberUrl: pageNorm, detail: true });
    const merged = mergeDraft(pick ?? {}, heur);
    merged.memberUrl = merged.memberUrl && sameSite(merged.memberUrl, pageUrl) ? merged.memberUrl : pageNorm;
    if (merged.email) merged.email = chooseEmail([merged.email, ...readContact($, scope, base).emails], emailMode, safeHost(merged.website));
    if (merged.name) drafts.push(merged);
    return { platform, isDetail, drafts, memberLinks: [], categoryLinks: [], nextLinks: [...nextLinks], title };
  }

  // Listing page: structured records plus cards built around member links.
  drafts.push(...structured);
  const covered = new Set(structured.map((d) => d.memberUrl).filter(Boolean) as string[]);

  for (const link of memberMap.values()) {
    if (covered.has(link.url)) continue;
    const anchor = $('a[href]').filter((_, a) => normalizeUrl($(a).attr('href') ?? '', base) === link.url).first();
    if (!anchor.length) continue;
    // climb to the largest ancestor that still contains only this one member link
    let best: El = anchor.parent();
    let cur: El = anchor;
    for (let i = 0; i < 8; i++) {
      const p = cur.parent();
      if (!p.length || p.is('body') || p.is('html')) break;
      const distinct = new Set<string>();
      p.find('a[href]').each((_, a) => {
        const u = normalizeUrl($(a).attr('href') ?? '', base);
        if (u && isMemberUrl(u)) distinct.add(u);
      });
      if (distinct.size > 1) break;
      best = p;
      cur = p;
    }
    const name =
      bestLinkText($, best, link.url, base) ||
      clean(best.find('h1,h2,h3,h4,h5').first().text()) ||
      link.text;
    if (!name || name.length < 2) continue;
    const d = draftFromScope($, best, base, emailMode, { name, memberUrl: link.url, detail: false });
    drafts.push(d);
  }

  return {
    platform,
    isDetail,
    drafts,
    memberLinks: [...memberMap.values()],
    categoryLinks: [...catMap.values()],
    nextLinks: [...nextLinks],
    title,
  };
}

function safeHost(u?: string): string {
  try {
    return u ? new URL(u).hostname : '';
  } catch {
    return '';
  }
}

/** Fill blanks in `a` from `b` (a wins). */
export function mergeDraft(a: BizDraft, b: BizDraft): BizDraft {
  const out: BizDraft = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof BizDraft, any][]) {
    if (k === '_orgOnly') continue;
    if (k === 'categories') {
      const set = new Map<string, string>();
      for (const c of [...((out.categories as string[]) ?? []), ...((v as string[]) ?? [])]) set.set(c.toLowerCase(), c);
      (out as any).categories = [...set.values()];
      continue;
    }
    if (!(out as any)[k] && v) (out as any)[k] = v;
  }
  return out;
}
