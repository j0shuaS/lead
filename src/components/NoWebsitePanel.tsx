'use client';

import { memo, type ReactNode } from 'react';
import { NO_WEBSITE_STATUSES, siteStatus, type SiteStatus } from '../lib/columns';
import type { Business } from '../lib/types';

export type SiteFilter = 'all' | 'has' | 'nosite' | SiteStatus;

export const SEGMENTS: { key: SiteFilter; label: string; hot?: boolean; sub?: boolean }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'has', label: 'Has a website' },
  { key: 'nosite', label: 'No website', hot: true },
  { key: 'unchecked', label: 'Not yet checked', sub: true },
  { key: 'confirmed-none', label: 'Confirmed on Google', sub: true },
  { key: 'social-only', label: 'Social page only', sub: true },
  { key: 'chamber-only', label: 'Only the chamber page', sub: true },
  { key: 'no-match', label: 'Not found on Google', sub: true },
  { key: 'found', label: 'Website found on Google' },
  { key: 'closed', label: 'Closed on Google' },
];

export function matchSite(b: Business, f: SiteFilter): boolean {
  if (f === 'all') return true;
  const s = siteStatus(b);
  if (f === 'has') return s === 'has-site' || s === 'found';
  if (f === 'nosite') return NO_WEBSITE_STATUSES.includes(s);
  return s === f;
}

/** One pass over the rows (instead of one filter per segment). */
export function countSegments(rows: Business[]): Record<string, number> {
  const out: Record<string, number> = {
    all: rows.length, has: 0, nosite: 0, unchecked: 0, 'confirmed-none': 0, 'social-only': 0,
    'chamber-only': 0, 'no-match': 0, found: 0, closed: 0, 'has-site': 0, error: 0,
  };
  for (const b of rows) {
    const s = siteStatus(b);
    out[s]++;
    if (s === 'has-site' || s === 'found') out.has++;
    if (NO_WEBSITE_STATUSES.includes(s)) out.nosite++;
  }
  return out;
}

export const NoWebsitePanel = memo(function NoWebsitePanel({
  kicker,
  counts,
  value,
  onChange,
  action,
}: {
  kicker: string;
  counts: Record<string, number>;
  value: SiteFilter;
  onChange: (f: SiteFilter) => void;
  action?: ReactNode;
}) {
  const none = counts.nosite ?? 0;
  const all = counts.all ?? 0;
  return (
    <section className="nosite" aria-label="Members with no website">
      <div className="nosite-lead">
        <div className="kicker">{kicker}</div>
        <div className="nosite-n">{none.toLocaleString()}</div>
        <p>
          member{none === 1 ? '' : 's'} with no website of their own
          {all ? <> — {Math.round((none / all) * 100)}% of {all.toLocaleString()}</> : null}.
        </p>
        {action}
      </div>
      <div className="segs" role="group" aria-label="Filter by website status">
        {SEGMENTS.map((s) => {
          const n = counts[s.key] ?? 0;
          return (
            <button
              key={s.key}
              className={`seg ${s.hot ? 'hot' : ''} ${s.sub ? 'sub' : ''}`}
              aria-pressed={value === s.key}
              onClick={() => onChange(value === s.key ? 'all' : s.key)}
              disabled={s.key !== 'all' && !n}
            >
              <span className="seg-n">{n.toLocaleString()}</span>
              <span className="seg-l">{s.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
});
