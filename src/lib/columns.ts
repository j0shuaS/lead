import type { Business } from './types';

export type ColumnKey = Exclude<keyof Business, 'id'>;

export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'websiteCheck', label: 'Website status' },
  { key: 'email', label: 'Email' },
  { key: 'street', label: 'Street' },
  { key: 'city', label: 'City' },
  { key: 'region', label: 'State' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'description', label: 'Description' },
  { key: 'categories', label: 'Categories' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'googleMapsUrl', label: 'Google Maps' },
  { key: 'memberUrl', label: 'Directory page' },
];

/** The website situation of a business, used for the "No website" area and its filters. */
export type SiteStatus =
  | 'has-site' // the directory lists a website
  | 'found' // directory had none, Google has one
  | 'unchecked' // no website listed, not yet checked on Google
  | 'confirmed-none' // matched on Google, still no website
  | 'social-only' // Google only lists a social/listing page
  | 'chamber-only' // Google's website is the chamber's own site, or redirects to it
  | 'no-match' // no website listed and Google couldn't be matched
  | 'closed'
  | 'error';

export function siteStatus(b: Business): SiteStatus {
  switch (b.websiteCheck) {
    case 'found':
    case 'confirmed-none':
    case 'social-only':
    case 'chamber-only':
    case 'no-match':
    case 'closed':
    case 'error':
      return b.websiteCheck;
  }
  return b.website ? 'has-site' : 'unchecked';
}

export const SITE_LABEL: Record<SiteStatus, string> = {
  'has-site': 'Has website',
  found: 'Website found on Google',
  unchecked: 'No website (not checked)',
  'confirmed-none': 'No website (confirmed on Google)',
  'social-only': 'No website (social page only)',
  'chamber-only': 'No website (only the chamber page)',
  'no-match': 'No website (not found on Google)',
  closed: 'Closed on Google',
  error: 'No website (check failed)',
};

/** Sort order for the "Website status" column: no-website rows first. */
export const STATUS_RANK: Record<SiteStatus, number> = {
  unchecked: 0, 'confirmed-none': 1, 'social-only': 2, 'chamber-only': 3, 'no-match': 4, error: 5, found: 6, 'has-site': 7, closed: 8,
};

/** Statuses that mean "this business has no website of its own". */
export const NO_WEBSITE_STATUSES: SiteStatus[] = ['unchecked', 'confirmed-none', 'social-only', 'chamber-only', 'no-match', 'error'];

export function isNoWebsite(b: Business): boolean {
  return NO_WEBSITE_STATUSES.includes(siteStatus(b));
}

export function cellValue(b: Business, key: ColumnKey): string {
  if (key === 'websiteCheck') return SITE_LABEL[siteStatus(b)];
  const v = b[key];
  return Array.isArray(v) ? v.join('; ') : String(v ?? '');
}

export function hasValue(b: Business, key: ColumnKey): boolean {
  if (key === 'websiteCheck') return b.websiteCheck !== '';
  const v = b[key];
  return Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '';
}
