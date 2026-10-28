'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clock } from '../lib/format';
import { readNdjson } from '../lib/ndjson';
import type { Business, BrowserMode, EmailMode, ScrapeEvent, ScrapeStats } from '../lib/types';
import { LedgerTable } from './LedgerTable';
import { LogView, type LogLine } from './LogView';
import { NoWebsitePanel, countSegments, type SiteFilter } from './NoWebsitePanel';

interface Props {
  rows: Business[];
  onRows: (rows: Business[]) => void;
  starredKeys: Set<string>;
  onToggleStar: (b: Business) => void;
  onSeeds: (urls: string[]) => void;
  onSendToGoogle: (rows: Business[]) => void;
}

export const ScrapeTab = memo(function ScrapeTab({ rows, onRows, starredKeys, onToggleStar, onSeeds, onSendToGoogle }: Props) {
  const [urlsText, setUrlsText] = useState('');
  const [maxResults, setMaxResults] = useState(200);
  const [followCategories, setFollowCategories] = useState(true);
  const [openMemberPages, setOpenMemberPages] = useState(false);
  const [delayMs, setDelayMs] = useState(1500);
  const [respectRobots, setRespectRobots] = useState(true);
  const [browser, setBrowser] = useState<BrowserMode>('off');
  const [emailMode, setEmailMode] = useState<EmailMode>('named-first');
  const [maxPages, setMaxPages] = useState(300);
  const [extraPrefixes, setExtraPrefixes] = useState('');

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState({ pagesFetched: 0, queued: 0, businesses: 0, duplicates: 0 });
  const [finalStats, setFinalStats] = useState<ScrapeStats | null>(null);
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');

  const store = useRef(new Map<string, Business>());
  const dirty = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const onRowsRef = useRef(onRows);
  onRowsRef.current = onRows;

  // Push streamed rows to the page a couple of times a second instead of once per event.
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current) {
        dirty.current = false;
        onRowsRef.current([...store.current.values()]);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const addLog = useCallback((level: LogLine['level'], message: string, url?: string) => {
    setLogs((l) => [...l.slice(-299), { level, message, url, t: clock() }]);
  }, []);

  const handleEvent = useCallback(
    (ev: ScrapeEvent) => {
      if (ev.type === 'business') {
        store.current.set(ev.business.id, ev.business);
        dirty.current = true;
      } else if (ev.type === 'progress') {
        setProgress({ pagesFetched: ev.pagesFetched, queued: ev.queued, businesses: ev.businesses, duplicates: ev.duplicates });
      } else if (ev.type === 'log') {
        addLog(ev.level, ev.message, ev.url);
      } else if (ev.type === 'done') {
        store.current = new Map(ev.businesses.map((b) => [b.id, b]));
        dirty.current = false;
        onRowsRef.current(ev.businesses);
        setFinalStats(ev.stats);
        setProgress((p) => ({ ...p, businesses: ev.businesses.length, duplicates: ev.stats.duplicatesMerged, pagesFetched: ev.stats.pagesFetched, queued: 0 }));
        const why = { complete: 'Finished', 'max-results': 'Stopped at the result limit', 'max-pages': 'Stopped at the page limit', cancelled: 'Cancelled' }[ev.stats.stoppedBy];
        addLog('info', `${why}: ${ev.businesses.length} businesses from ${ev.stats.pagesFetched} pages in ${(ev.stats.elapsedMs / 1000).toFixed(1)}s.`);
        const none = ev.businesses.filter((b) => !b.website).length;
        if (none) addLog('info', `${none} of ${ev.businesses.length} members list no website. Use "Check on Google Maps" to verify them.`);
      }
    },
    [addLog],
  );

  async function start() {
    if (running) return;
    const urls = urlsText.split(/[\s,]+/).filter(Boolean);
    if (!urls.length) {
      addLog('error', 'Enter at least one directory URL.');
      return;
    }
    onSeeds(urls);
    store.current = new Map();
    dirty.current = false;
    onRows([]);
    setFinalStats(null);
    setProgress({ pagesFetched: 0, queued: 0, businesses: 0, duplicates: 0 });
    setLogs([]);
    setSiteFilter('all');
    setRunning(true);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: c.signal,
        body: JSON.stringify({
          urls, maxResults, followCategories, openMemberPages, delayMs, respectRobots, browser, emailMode, maxPages,
          extraPrefixes: extraPrefixes.split(/[\s,]+/).filter(Boolean),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        addLog('error', j?.error ?? `Server error (HTTP ${res.status}).`);
        return;
      }
      await readNdjson(res, (ev) => handleEvent(ev as ScrapeEvent));
    } catch (e: any) {
      if (e?.name === 'AbortError') addLog('warn', 'Stopped. Rows collected so far are kept below.');
      else addLog('error', `Connection problem: ${e?.message ?? e}`);
    } finally {
      dirty.current = false;
      onRowsRef.current([...store.current.values()]);
      setRunning(false);
      ctrl.current = null;
    }
  }

  const counts = useMemo(() => countSegments(rows), [rows]);
  const sendable = useMemo(() => rows.filter((b) => !b.website), [rows]);
  const pct = running
    ? Math.min(96, Math.round((progress.pagesFetched / Math.max(1, progress.pagesFetched + progress.queued)) * 100))
    : finalStats
      ? 100
      : 0;

  return (
    <>
      <div className="grid">
        <section className="panel reveal" style={{ ['--i' as any]: 1 }}>
          <h2><span className="no">01</span> Setup</h2>

          <label className="field" htmlFor="urls" style={{ marginTop: 0 }}>
            Directory URLs <span className="hint">One per line. GrowthZone, ChamberMaster, or any page with schema.org LocalBusiness / Organization markup.</span>
          </label>
          <textarea
            id="urls"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={'https://business.examplechamber.org/list\nhttps://www.anotherchamber.com/member-directory'}
            spellCheck={false}
            disabled={running}
          />

          <div className="row2">
            <div>
              <label className="field" htmlFor="max">Max results</label>
              <input id="max" type="number" min={1} max={10000} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} disabled={running} />
            </div>
            <div>
              <label className="field" htmlFor="delay">Delay between requests (ms)</label>
              <input id="delay" type="number" min={250} step={250} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} disabled={running} />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="toggle">
              <input type="checkbox" checked={followCategories} onChange={(e) => setFollowCategories(e.target.checked)} disabled={running} />
              <span className="box" />
              <span><b>Follow category pages</b><small>Crawl every category on the same directory and merge businesses that appear in several.</small></span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={openMemberPages} onChange={(e) => setOpenMemberPages(e.target.checked)} disabled={running} />
              <span className="box" />
              <span><b>Open individual member pages</b><small>One extra request per business. Slower, but finds addresses and websites the list view hides.</small></span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={respectRobots} onChange={(e) => setRespectRobots(e.target.checked)} disabled={running} />
              <span className="box" />
              <span><b>Respect robots.txt</b><small>Skip disallowed paths and honor any Crawl-delay. Recommended.</small></span>
            </label>
          </div>

          <details className="adv">
            <summary>Advanced</summary>
            <div className="row2">
              <div>
                <label className="field" htmlFor="br">JavaScript pages</label>
                <select id="br" value={browser} onChange={(e) => setBrowser(e.target.value as BrowserMode)} disabled={running}>
                  <option value="off">Off (static HTML)</option>
                  <option value="auto">Auto (only if a page is empty)</option>
                  <option value="always">Always (headless browser)</option>
                </select>
              </div>
              <div>
                <label className="field" htmlFor="pg">Max pages</label>
                <input id="pg" type="number" min={1} max={5000} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} disabled={running} />
              </div>
            </div>
            <label className="field" htmlFor="em">Email preference</label>
            <select id="em" value={emailMode} onChange={(e) => setEmailMode(e.target.value as EmailMode)} disabled={running}>
              <option value="named-first">Listed contact, then info@</option>
              <option value="generic-only">Generic (info@…) only</option>
            </select>
            <label className="field" htmlFor="xp">Also count as “no website”</label>
            <textarea
              id="xp"
              value={extraPrefixes}
              onChange={(e) => setExtraPrefixes(e.target.value)}
              placeholder={'business.montgomerycc.org/list\nmembers.otherchamber.org'}
              spellCheck={false}
              disabled={running}
              style={{ minHeight: 64 }}
            />
            <span className="hint">
              One per line. A scraped “website” starting with any of these is treated as none. The chamber URL you entered is already covered; permanent entries live in <code>src/lib/blocklist.ts</code>.
            </span>
            <span className="hint" style={{ marginTop: 8 }}>
              Headless mode needs <code>npm i playwright</code> and <code>npx playwright install chromium</code>.
            </span>
          </details>

          <div className="actions">
            <button className="btn hot" onClick={start} disabled={running || !urlsText.trim()}>{running ? 'Crawling…' : 'Run the crawl'}</button>
            <button className="btn ink" onClick={() => ctrl.current?.abort()} disabled={!running}>Stop</button>
          </div>
          <p className="fine">
            Reads only publicly accessible pages, never logs in, never stores contact names, and requests pages one at a time with a delay (minimum 250 ms).
          </p>
        </section>

        <section className="panel reveal" style={{ ['--i' as any]: 2 }}>
          <h2><span className="no">02</span> Dispatch</h2>
          <div className="stats">
            <div className="stat"><div className="n">{progress.businesses}</div><div className="l">Businesses</div></div>
            <div className="stat"><div className="n">{progress.pagesFetched}</div><div className="l">Pages read</div></div>
            <div className="stat"><div className="n">{progress.queued}</div><div className="l">In queue</div></div>
            <div className="stat"><div className="n">{progress.duplicates}</div><div className="l">Dupes merged</div></div>
          </div>
          <div className={`meter ${running ? 'live' : ''}`} aria-hidden><i style={{ width: `${pct}%` }} /></div>
          <LogView logs={logs} busy={running} empty="waiting for a directory url" />
        </section>
      </div>

      {rows.length > 0 && (
        <NoWebsitePanel
          kicker="03 · No website"
          counts={counts}
          value={siteFilter}
          onChange={setSiteFilter}
          action={
            <button className="btn hot" onClick={() => onSendToGoogle(sendable)} disabled={running || !sendable.length}>
              Check {sendable.length.toLocaleString()} on Google Maps →
            </button>
          }
        />
      )}

      <LedgerTable
        rows={rows}
        starredKeys={starredKeys}
        onToggleStar={onToggleStar}
        siteFilter={siteFilter}
        fileBase="members"
        emptyTitle="Nothing here yet."
        emptyHint="Run a crawl and the businesses will fill in as they are found."
      />
    </>
  );
});
