import { normName, phoneDigits, zip5 } from './dedupe';
import type { Business } from './types';

/**
 * A key for "the same business" that survives re-crawls and CSV round trips
 * (row ids don't): the directory member page when known, else name + phone + zip.
 */
export function bizKey(b: Business): string {
  if (b.memberUrl) return `m:${b.memberUrl.toLowerCase()}`;
  return `n:${normName(b.name)}|${phoneDigits(b.phone)}|${zip5(b.postalCode)}`;
}

/** Cheap signature of the fields that change after a Google check, to detect updates. */
export function bizSig(b: Business): string {
  return [b.websiteCheck, b.website, b.googleMapsUrl, b.email, b.phone, b.street, b.city, b.facebook, b.instagram].join('\u0001');
}
