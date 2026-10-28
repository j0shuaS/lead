/**
 * Google Places API (New) verification for members that list no website.
 *
 * Approach carried over from the LEAD project: a Text Search request with a field mask,
 * reading `websiteUri` from the matched listing. New here: the member is looked up by
 * name + address from the chamber directory and a result is only accepted when name AND
 * address (or phone) agree, so a similarly named business elsewhere never "has" the website.
 */
import { normName, phoneDigits, zip5 } from './dedupe';
import { classifySocial, normalizeUrl, type SocialKind } from './extract';
import { USER_AGENT, assertPublicUrl } from './fetcher';
import type { WebsiteCheck } from './types';

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// Only the fields we use (keeps each request on the cheaper side of Places pricing).
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

export interface VerifyInput {
  id: string;
  name: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
}

export interface VerifyOutcome {
  id: string;
  check: WebsiteCheck;
  website: string;
  googleMapsUrl: string;
  matchedName: string;
  matchedAddress: string;
  confidence: number;
  social: Partial<Record<SocialKind, string>>;
  reason?: string;
}

export interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
}

export interface PlacesDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The chamber's own site(s) — the directory URLs the user entered. */
  chamberUrls?: string[];
  /** "City, ST" used to search Google for members whose directory entry has no address. */
  areaHint?: string;
  /** Extra URL prefixes that never count as a real website (see blocklist.ts). */
  blockedPrefixes?: string[];
  /** Follow redirects from Google's website to see if they land on the chamber site (default true). */
  followRedirects?: boolean;
  /** Tests only: allow loopback addresses when following redirects. */
  allowPrivate?: boolean;
}

/* ------------------------------------------------------------------ */
/* "does this website really just belong to the chamber?"              */
/* ------------------------------------------------------------------ */

const PREFIX_LEN = 15;
const TWO_PART_TLDS = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;

/** "https://www.Foo.com/a/" -> "foo.com/a" */
function stripUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#]+$/, '');
}

function baseDomain(u: string): string {
  const host = stripUrl(u).split(/[/?#:]/)[0];
  const parts = host.split('.');
  const keep = TWO_PART_TLDS.test(host) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/**
 * True when `site` is the chamber's website. Rule requested for lead: compare the first
 * 15 characters of the URL (scheme and "www." ignored). A chamber address shorter than
 * 15 characters must match as a whole host/path segment, so "abc.org" doesn't swallow
 * "abc.organics.com". The registrable domain is also compared so another subdomain of the
 * chamber (e.g. members.chamber.org vs www.chamber.org) is still recognised.
 */
export function isChamberUrl(site: string, chamberUrls: string[]): boolean {
  const s = stripUrl(site);
  if (!s) return false;
  for (const c of chamberUrls) {
    const cs = stripUrl(c);
    if (!cs) continue;
    if (cs.length >= PREFIX_LEN) {
      if (s.slice(0, PREFIX_LEN) === cs.slice(0, PREFIX_LEN)) return true;
    } else if (s.startsWith(cs) && (s.length === cs.length || /[/?#:]/.test(s[cs.length]))) {
      return true;
    }
    const bd = baseDomain(c);
    if (bd.includes('.') && bd === baseDomain(site)) return true;
  }
  return false;
}

/** True when `site` starts with one of the prefixes (scheme and www ignored, path-boundary aware). */
export function matchesBlockedPrefix(site: string, prefixes: string[]): boolean {
  const s = stripUrl(site);
  if (!s) return false;
  return prefixes.some((p) => {
    const ps = stripUrl(p);
    return !!ps && s.startsWith(ps) && (s.length === ps.length || /[/?#:]/.test(s[ps.length]));
  });
}

/**
 * Follow HTTP redirects (no body is read) and return every URL visited.
 * Only public addresses are contacted; failures simply end the chain.
 */
export async function redirectChain(startUrl: string, deps: PlacesDeps): Promise<string[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  const chain: string[] = [startUrl];
  let url = startUrl;
  for (let hop = 0; hop < 6; hop++) {
    try {
      await assertPublicUrl(new URL(url), deps.allowPrivate);
      const res = await doFetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*;q=0.5' },
        signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      const loc = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        chain.push(url);
        continue;
      }
    } catch {
      /* unreachable / blocked / timed out: stop following */
    }
    break;
  }
  return chain;
}

/** `fatal` errors (bad key, API not enabled, billing) mean every further request would fail too. */
export class PlacesError extends Error {
  constructor(
    message: string,
    public status: number,
    public fatal = false,
  ) {
    super(message);
    this.name = 'PlacesError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function searchPlaces(textQuery: string, deps: PlacesDeps): Promise<GooglePlace[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await doFetch(PLACES_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': deps.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({ textQuery, pageSize: 5 }),
        signal: deps.signal,
      });
    } catch (e: any) {
      if (deps.signal?.aborted) throw e;
      if (attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new PlacesError('Could not reach the Google Places API. Check your internet connection.', 502);
    }

    if (res.ok) {
      const data = (await res.json()) as { places?: GooglePlace[] };
      return data.places ?? [];
    }

    let message = `Google Places API request failed (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as any;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) {
      throw new PlacesError(
        `${message} Usually: "Places API (New)" is not enabled for the project, billing is off, or the key is restricted from calling it.`,
        res.status,
        true,
      );
    }
    if (res.status === 400 && /api key|key not valid|invalid/i.test(message)) {
      throw new PlacesError(message, 400, true);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new PlacesError(message, res.status);
  }
  throw new PlacesError('Google Places API kept failing.', 502);
}

/* ------------------------------------------------------------------ */
/* matching                                                            */
/* ------------------------------------------------------------------ */

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'in', 'for', 'inc', 'llc', 'co', 'company', 'corp', 'ltd']);
const tokens = (s: string) => normName(s).split(' ').filter((t) => t && !STOP.has(t));

/** 0..1 — Jaccard overlap, or a slightly discounted containment when one name extends the other. */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const containment = inter / Math.min(A.size, B.size);
  return Math.max(jaccard, containment * 0.9);
}

function addressScore(b: VerifyInput, formatted: string): number {
  const f = formatted.toLowerCase();
  let s = 0;
  const z = zip5(b.postalCode);
  if (z && formatted.toUpperCase().includes(z)) s += 0.4;
  const num = /^\d+/.exec(b.street.trim())?.[0];
  if (num && new RegExp(`\\b${num}\\b`).test(f)) s += 0.3;
  if (b.city && f.includes(b.city.toLowerCase())) s += 0.2;
  return s;
}

export interface Area {
  city: string;
  region: string;
}

/** "Christiansburg, VA" -> { city: 'Christiansburg', region: 'VA' } */
export function parseArea(raw?: string): Area | null {
  const parts = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const region = /^[A-Za-z]{2}\b/.test(parts[1] ?? '') ? parts[1].slice(0, 2).toUpperCase() : '';
  return { city: parts[0], region };
}

function areaScore(area: Area, formatted: string): number {
  let s = 0;
  if (area.city && formatted.toLowerCase().includes(area.city.toLowerCase())) s += 0.3;
  if (area.region && new RegExp(`\\b${area.region}\\b`).test(formatted.toUpperCase())) s += 0.2;
  return s;
}

export function matchPlace(
  b: VerifyInput,
  places: GooglePlace[],
  area?: Area | null,
): { place: GooglePlace; confidence: number } | null {
  const myPhone = phoneDigits(b.phone);
  const noAddr = !b.street && !b.city && !b.postalCode;
  let best: { place: GooglePlace; confidence: number } | null = null;
  for (const p of places) {
    const name = p.displayName?.text ?? '';
    if (!name) continue;
    const ns = nameSimilarity(b.name, name);
    const as = noAddr ? (area ? areaScore(area, p.formattedAddress ?? '') : 0) : addressScore(b, p.formattedAddress ?? '');
    const theirPhone = phoneDigits(p.nationalPhoneNumber ?? '');
    const phoneMatch = !!myPhone && !!theirPhone && myPhone === theirPhone;
    // Without an address on the directory, a matching phone number, or a strong name match inside
    // the chosen area, is required.
    const accepted = noAddr
      ? (phoneMatch && ns >= 0.3) || (ns >= 0.7 && as >= 0.3)
      : (phoneMatch && ns >= 0.3) || (ns >= 0.55 && as >= 0.3) || (ns >= 0.8 && as >= 0.2);
    if (!accepted) continue;
    const confidence = Math.min(1, ns * 0.6 + as * 0.5 + (phoneMatch ? 0.4 : 0));
    if (!best || confidence > best.confidence) best = { place: p, confidence };
  }
  return best;
}

/** Facebook/Instagram/Yelp/etc. pages are listings, not the business's own website. */
const LISTING_HOST =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|twitter\.com|x\.com|linkedin\.com|yelp\.com|tiktok\.com|youtube\.com|youtu\.be|linktr\.ee|yellowpages\.com|mapquest\.com|bbb\.org|nextdoor\.com|pinterest\.com)$/i;

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

export async function verifyBusiness(input: VerifyInput, deps: PlacesDeps): Promise<VerifyOutcome> {
  const base: VerifyOutcome = {
    id: input.id,
    check: 'no-match',
    website: '',
    googleMapsUrl: '',
    matchedName: '',
    matchedAddress: '',
    confidence: 0,
    social: {},
  };

  if (!input.name.trim()) return { ...base, reason: 'No business name.' };
  const hasAddr = !!(input.street || input.city || input.postalCode);
  const area = parseArea(deps.areaHint);
  if (!hasAddr && !area && !input.phone) {
    return { ...base, reason: 'No address, area or phone number to match a Google listing against.' };
  }

  // With an address: name + address. Without one: name + the chosen area (or just the name,
  // in which case only a phone-number match is accepted).
  const query = (hasAddr
    ? [input.name, input.street, input.city, [input.region, input.postalCode].filter(Boolean).join(' ')]
    : [input.name, deps.areaHint ?? '']
  )
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

  const places = await searchPlaces(query, deps);
  const m = matchPlace(input, places, area);
  if (!m) return { ...base, reason: places.length ? 'Google results did not match this name and address.' : 'No Google results.' };

  const p = m.place;
  const out: VerifyOutcome = {
    ...base,
    googleMapsUrl: p.googleMapsUri ?? '',
    matchedName: p.displayName?.text ?? '',
    matchedAddress: p.formattedAddress ?? '',
    confidence: Number(m.confidence.toFixed(2)),
  };

  if (p.businessStatus === 'CLOSED_PERMANENTLY') return { ...out, check: 'closed' };

  const site = (p.websiteUri ?? '').trim();
  if (!site) return { ...out, check: 'confirmed-none' };

  const social = classifySocial(site);
  let host = '';
  try {
    host = new URL(site).hostname;
  } catch {
    return { ...out, check: 'confirmed-none', reason: 'Google returned an unusable website value.' };
  }
  if (social || LISTING_HOST.test(host)) {
    return { ...out, check: 'social-only', social: social ? { [social.kind]: social.url } : {}, website: '' };
  }

  // The "website" is just the chamber's own page (or bounces there): not the business's site.
  const chamber = deps.chamberUrls ?? [];
  const blocked = deps.blockedPrefixes ?? [];
  if (chamber.length || blocked.length) {
    const isChamber = (u: string) => (chamber.length > 0 && isChamberUrl(u, chamber)) || matchesBlockedPrefix(u, blocked);
    if (isChamber(site)) {
      return { ...out, check: 'chamber-only', reason: 'Google lists the chamber website, not the business\'s own.' };
    }
    if (deps.followRedirects !== false) {
      const chain = await redirectChain(site, deps);
      if (chain.length > 1 && chain.slice(1).some(isChamber)) {
        return { ...out, check: 'chamber-only', reason: `The listed website redirects to the chamber site (${chain[chain.length - 1]}).` };
      }
    }
  }
  // Same format as the scraper's websites: no trailing slash on a bare domain.
  const cleanSite = (normalizeUrl(site) ?? site).replace(/^(https?:\/\/[^/?#]+)\/$/, '$1');
  return { ...out, check: 'found', website: cleanSite };
}
