/**
 * Website prefixes that never count as a business's own website.
 *
 * If Google (or the directory) lists a "website" that starts with one of these, the member is
 * treated as having NO website. Matching ignores "https://" and "www." and respects path
 * boundaries: "business.montgomerycc.org/list" matches ".../list" and ".../list/member/x"
 * but not ".../listings".
 *
 * Add one string per line. The chamber URL(s) you enter in the app are handled automatically,
 * so this is for extra spots (member-directory subdomains, listing platforms, etc.).
 */
export const NO_WEBSITE_PREFIXES: string[] = [
  'business.montgomerycc.org/list',
  // 'members.examplechamber.org',
  // 'directory.anotherchamber.com/listing',
];
