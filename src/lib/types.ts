/**
 * Result of checking a no-website member against Google Maps (Places API).
 * '' means "not checked".
 */
export type WebsiteCheck =
  | ''
  | 'found' // Google lists a real website -> copied into `website`
  | 'confirmed-none' // matched on Google and it has no website
  | 'social-only' // Google's "website" is just a Facebook/Instagram/Yelp/... page
  | 'chamber-only' // Google's "website" is the chamber's own site (or redirects to it)
  | 'no-match' // could not confidently match the member to a Google listing
  | 'closed' // Google says the business is permanently closed
  | 'error'; // the lookup failed (see log)

export interface Business {
  id: string;
  name: string;
  email: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  phone: string;
  website: string;
  description: string;
  categories: string[];
  facebook: string;
  instagram: string;
  linkedin: string;
  twitter: string;
  /** The directory page this business was found on / its member page. */
  memberUrl: string;
  /** Google Maps verification outcome for members that had no website. */
  websiteCheck: WebsiteCheck;
  /** Link to the matched Google Maps listing, when one was found. */
  googleMapsUrl: string;
}

/** A partially-filled business as produced by the extractors. */
export type BizDraft = Partial<Omit<Business, 'id'>> & {
  /** True when the record came from a bare schema.org Organization node. */
  _orgOnly?: boolean;
};

export type BrowserMode = 'off' | 'auto' | 'always';
export type EmailMode = 'named-first' | 'generic-only';

export interface ScrapeOptions {
  urls: string[];
  maxResults: number;
  followCategories: boolean;
  openMemberPages: boolean;
  delayMs: number;
  respectRobots: boolean;
  browser: BrowserMode;
  emailMode: EmailMode;
  maxPages: number;
  /** Extra URL prefixes that never count as a business's own website (besides blocklist.ts). */
  extraPrefixes?: string[];
}

export interface ScrapeStats {
  pagesFetched: number;
  businesses: number;
  duplicatesMerged: number;
  errors: number;
  robotsBlocked: number;
  elapsedMs: number;
  stoppedBy: 'complete' | 'max-results' | 'max-pages' | 'cancelled';
}

export type ScrapeEvent =
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; url?: string }
  | { type: 'business'; business: Business }
  | { type: 'progress'; pagesFetched: number; queued: number; businesses: number; duplicates: number }
  | { type: 'done'; stats: ScrapeStats; businesses: Business[] };

export const EMPTY_BUSINESS: Omit<Business, 'id'> = {
  name: '',
  email: '',
  street: '',
  city: '',
  region: '',
  postalCode: '',
  phone: '',
  website: '',
  description: '',
  categories: [],
  facebook: '',
  instagram: '',
  linkedin: '',
  twitter: '',
  memberUrl: '',
  websiteCheck: '',
  googleMapsUrl: '',
};
