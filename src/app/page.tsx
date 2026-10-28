'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleTab } from '../components/GoogleTab';
import { ScrapeTab } from '../components/ScrapeTab';
import { StarredTab } from '../components/StarredTab';
import { bizKey, bizSig } from '../lib/key';
import type { Business } from '../lib/types';

type Tab = 'scrape' | 'google' | 'starred';
const STAR_STORE = 'lead.starred.v1';

export default function Page() {
  const [tab, setTab] = useState<Tab>('scrape');
  const [scrapeRows, setScrapeRows] = useState<Business[]>([]);
  const [googleRows, setGoogleRows] = useState<Business[]>([]);
  const [seedUrls, setSeedUrls] = useState<string[]>([]);

  // ---- stars: key -> business snapshot, kept in localStorage ----
  const [starred, setStarred] = useState<Map<string, Business>>(new Map());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STAR_STORE);
      if (raw) setStarred(new Map(JSON.parse(raw) as [string, Business][]));
    } catch {
      /* storage unavailable or corrupt: start empty */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // don't overwrite saved stars with the empty initial state
    try {
      localStorage.setItem(STAR_STORE, JSON.stringify([...starred]));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [starred, hydrated]);

  // keep starred snapshots fresh when the same business shows up with newer data (e.g. after a Google check)
  useEffect(() => {
    if (!hydrated || starred.size === 0) return;
    const latest = new Map<string, Business>();
    for (const b of scrapeRows) {
      const k = bizKey(b);
      if (starred.has(k)) latest.set(k, b);
    }
    for (const b of googleRows) {
      const k = bizKey(b);
      if (starred.has(k)) latest.set(k, b);
    }
    let next: Map<string, Business> | null = null;
    for (const [k, b] of latest) {
      if (bizSig(starred.get(k)!) !== bizSig(b)) {
        next ??= new Map(starred);
        next.set(k, b);
      }
    }
    if (next) setStarred(next);
  }, [scrapeRows, googleRows, starred, hydrated]);

  const starredKeys = useMemo(() => new Set(starred.keys()), [starred]);
  const starredRows = useMemo(() => [...starred.values()], [starred]);

  const toggleStar = useCallback((b: Business) => {
    setStarred((prev) => {
      const k = bizKey(b);
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, b);
      return next;
    });
  }, []);
  const clearStars = useCallback(() => setStarred(new Map()), []);

  const sendToGoogle = useCallback((rows: Business[]) => {
    setGoogleRows(rows);
    setTab('google');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  const TABS: { key: Tab; no: string; label: string; n?: number }[] = [
    { key: 'scrape', no: '01', label: 'Scrape', n: scrapeRows.length },
    { key: 'google', no: '02', label: 'Google check', n: googleRows.length },
    { key: 'starred', no: '★', label: 'Starred', n: starred.size },
  ];

  return (
    <main className="wrap">
      <header className="mast reveal" style={{ ['--i' as any]: 0 }}>
        <h1 className="wordmark">
          lead<span className="dot">.</span>
        </h1>
        <div className="mast-side">
          <div className="kicker">Chamber directory → no-website leads</div>
          <p className="tagline">Scan every member, spot who has no website, then confirm it on Google Maps.</p>
        </div>
        <span className="stamp">Public pages only</span>
      </header>

      <div className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            className="tab"
            onClick={() => setTab(t.key)}
          >
            <span className="no">{t.no}</span> {t.label}
            {!!t.n && <span className="tn">{t.n.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      {/* All three stay mounted so a running crawl or check keeps going while you look at another tab. */}
      <div role="tabpanel" id="panel-scrape" aria-labelledby="tab-scrape" hidden={tab !== 'scrape'}>
        <ScrapeTab
          rows={scrapeRows}
          onRows={setScrapeRows}
          starredKeys={starredKeys}
          onToggleStar={toggleStar}
          onSeeds={setSeedUrls}
          onSendToGoogle={sendToGoogle}
        />
      </div>
      <div role="tabpanel" id="panel-google" aria-labelledby="tab-google" hidden={tab !== 'google'}>
        <GoogleTab
          rows={googleRows}
          onRows={setGoogleRows}
          scrapeRows={scrapeRows}
          seedUrls={seedUrls}
          starredKeys={starredKeys}
          onToggleStar={toggleStar}
        />
      </div>
      <div role="tabpanel" id="panel-starred" aria-labelledby="tab-starred" hidden={tab !== 'starred'}>
        <StarredTab rows={starredRows} starredKeys={starredKeys} onToggleStar={toggleStar} onClear={clearStars} />
      </div>

      <footer className="foot">
        <span>lead. — built for research, analysis and outreach lists from publicly listed business information.</span>
        <span>“Confirmed” means Google lists the business with no website; it can&rsquo;t prove a site exists nowhere. Check each site&rsquo;s terms and the laws that apply to your outreach.</span>
      </footer>
    </main>
  );
}
