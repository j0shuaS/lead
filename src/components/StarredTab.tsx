'use client';

import { memo, useMemo, useState } from 'react';
import type { Business } from '../lib/types';
import { LedgerTable } from './LedgerTable';
import { NoWebsitePanel, countSegments, type SiteFilter } from './NoWebsitePanel';

export const StarredTab = memo(function StarredTab({
  rows,
  starredKeys,
  onToggleStar,
  onClear,
}: {
  rows: Business[];
  starredKeys: Set<string>;
  onToggleStar: (b: Business) => void;
  onClear: () => void;
}) {
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');
  const counts = useMemo(() => countSegments(rows), [rows]);

  return (
    <>
      <section className="panel reveal" style={{ ['--i' as any]: 1, marginBottom: 26 }}>
        <h2><span className="no">★</span> Starred</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)' }}>
          Businesses you starred in the Scrape or Google check tabs. Stars are saved in this browser, so they survive a refresh and a new crawl.
          Star or un-star with the ☆ in the first column of any table.
        </p>
        <button className="btn" onClick={() => window.confirm(`Remove all ${rows.length} stars?`) && onClear()} disabled={!rows.length}>
          Clear all stars
        </button>
      </section>

      {rows.length > 0 && <NoWebsitePanel kicker="Starred · no website" counts={counts} value={siteFilter} onChange={setSiteFilter} />}

      <LedgerTable
        rows={rows}
        starredKeys={starredKeys}
        onToggleStar={onToggleStar}
        siteFilter={siteFilter}
        defaultSort="name"
        fileBase="starred"
        title="Starred ledger"
        emptyTitle="No stars yet."
        emptyHint="Click the ☆ next to a business in the Scrape or Google check tab."
      />
    </>
  );
});
