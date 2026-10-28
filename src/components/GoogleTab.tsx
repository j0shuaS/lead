'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { csvToBusinesses } from '../lib/csv';
import { clock } from '../lib/format';
import { readNdjson } from '../lib/ndjson';
import type { Business } from '../lib/types';
import { LedgerTable } from './LedgerTable';
import { LogView, type LogLine } from './LogView';
import { NoWebsitePanel, countSegments, type SiteFilter } from './NoWebsitePanel';

const SOCIALS = ['facebook', 'instagram', 'linkedin', 'twitter'] as const;

/** Members the Google check looks at: no website yet, and unchecked / previously unmatched / failed. */
const needsCheck = (b: Business) => !b.website && (!b.websiteCheck || b.websiteCheck === 'no-match' || b.websiteCheck === 'error');

interface Props {
  rows: Business[];
  onRows: (rows: Business[]) => void;
  scrapeRows: Business[];
  seedUrls: string[];
  starredKeys: Set<string>;
  onToggleStar: (b: Business) => void;
}

export const GoogleTab = memo(function GoogleTab({ rows, onRows, scrapeRows, seedUrls, starredKeys, onToggleStar }: Props) {
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [chamberText, setChamberText] = useState('');
  const [areaHint, setAreaHint] = useState('');
  const [extraPrefixes, setExtraPrefixes] = useState('');
  const [maxLookups, setMaxLookups] = useState(200);
  const [siteFilter, setSiteFilter] = useState<SiteFilter>('all');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const store = useRef(new Map<string, Business>());
  const dirty = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onRowsRef = useRef(onRows);
  onRowsRef.current = onRows;

  // keep the working map in step with rows replaced from outside (import / "send from scrape")
  useEffect(() => {
    if (!verifying) store.current = new Map(rows.map((b) => [b.id, b]));
  }, [rows, verifying]);

  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current) {
        dirty.current = false;
        onRowsRef.current([...store.current.values()]);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/verify')
      .then((r) => r.json())
      .then((j) => setGoogleConfigured(!!j?.configured))
      .catch(() => setGoogleConfigured(false));
  }, []);

  const addLog = useCallback((level: LogLine['level'], message: string) => {
    setLogs((l) => [...l.slice(-299), { level, message, t: clock() }]);
  }, []);

  // defaults inferred from the data
  const inferredArea = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of rows) if (b.city && b.region) c.set(`${b.city}, ${b.region}`, (c.get(`${b.city}, ${b.region}`) ?? 0) + 1);
    let best = '';
    let n = 0;
    for (const [k, v] of c) if (v > n) [best, n] = [k, v];
    return best;
  }, [rows]);

  const inferredChamber = useMemo(() => {
    const o = new Map<string, number>();
    for (const b of rows) {
      if (!b.memberUrl) continue;
      try {
        const u = new URL(b.memberUrl);
        o.set(u.origin, (o.get(u.origin) ?? 0) + 1);
      } catch {
        /* ignore */
      }
    }
    return [...o.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  }, [rows]);

  const counts = useMemo(() => countSegments(rows), [rows]);
  const recheck = useMemo(() => rows.filter(needsCheck).length, [rows]);
  const toCheck = Math.min(recheck, Math.max(1, maxLookups));

  /* ---------------- import ---------------- */
  async function importFile(file: File) {
    try {
      if (file.size > 25_000_000) throw new Error('That file is over 25 MB.');
      const text = await file.text();
      const r = csvToBusinesses(text, 'g');
      if (!r.rows.length) throw new Error('No rows with a business name were found in that file.');
      store.current = new Map(r.rows.map((b) => [b.id, b]));
      dirty.current = false;
      onRows(r.rows);
      setLogs([]);
      setSiteFilter('all');
      const none = r.rows.filter((b) => !b.website).length;
      setImportMsg({
        ok: true,
        text: `Imported ${r.rows.length.toLocaleString()} businesses from ${file.name} (${none.toLocaleString()} with no website)${r.skipped ? `, skipped ${r.skipped} rows without a name` : ''}.`,
      });
    } catch (e: any) {
      setImportMsg({ ok: false, text: e?.message ?? 'Could not read that file.' });
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void importFile(f);
  }
  function useScrape() {
    onRows(scrapeRows);
    setLogs([]);
    setSiteFilter('all');
    setImportMsg({ ok: true, text: `Loaded ${scrapeRows.length.toLocaleString()} businesses from the Scrape tab.` });
  }

  /* ---------------- check ---------------- */
  async function runVerify() {
    const todo = [...store.current.values()].filter(needsCheck).slice(0, Math.max(1, maxLookups));
    if (!todo.length) {
      addLog('info', 'Nothing to check: every business already has a website or has been checked.');
      return;
    }
    const typed = chamberText.split(/[\s,]+/).filter(Boolean);
    const chamberUrls = typed.length ? typed : seedUrls.length ? seedUrls : inferredChamber;

    setVerifying(true);
    setProgress({ done: 0, total: todo.length });
    addLog('info', `Checking ${todo.length} no-website member${todo.length === 1 ? '' : 's'} on Google Maps…`);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: c.signal,
        body: JSON.stringify({
          chamberUrls,
          areaHint: areaHint.trim() || inferredArea,
          extraPrefixes: extraPrefixes.split(/[\s,]+/).filter(Boolean),
          businesses: todo.map((b) => ({ id: b.id, name: b.name, street: b.street, city: b.city, region: b.region, postalCode: b.postalCode, phone: b.phone })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        addLog('error', j?.error ?? `Google check failed (HTTP ${res.status}).`);
        return;
      }
      await readNdjson(res, (ev) => {
        if (ev.type === 'result') {
          const b = store.current.get(ev.id);
          if (!b) return;
          const n: Business = { ...b, websiteCheck: ev.check, googleMapsUrl: ev.googleMapsUrl || b.googleMapsUrl };
          if (ev.check === 'found' && ev.website) n.website = ev.website;
          for (const k of SOCIALS) if (ev.social?.[k] && !n[k]) n[k] = ev.social[k];
          store.current.set(ev.id, n);
          dirty.current = true;
        } else if (ev.type === 'progress') {
          setProgress({ done: ev.done, total: ev.total });
        } else if (ev.type === 'log') {
          addLog(ev.level, ev.message);
        } else if (ev.type === 'done') {
          const n = ev.counts ?? {};
          if (ev.lackedArea) {
            addLog(
              'warn',
              `${ev.lackedArea} member${ev.lackedArea === 1 ? ' has' : 's have'} no address and no area was set, so Google could only be matched by phone number. Enter an area (e.g. "Christiansburg, VA") and check again.`,
            );
          }
          addLog(
            'info',
            `Google check ${ev.stoppedEarly ? 'stopped' : 'finished'}: ${n['confirmed-none'] ?? 0} confirmed no website, ${n.found ?? 0} website found, ${n['social-only'] ?? 0} social page only, ${n['chamber-only'] ?? 0} chamber page only, ${n['no-match'] ?? 0} not matched, ${n.closed ?? 0} closed.`,
          );
        }
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') addLog('warn', 'Google check stopped. Results so far are kept.');
      else addLog('error', `Google check problem: ${e?.message ?? e}`);
    } finally {
      dirty.current = false;
      onRowsRef.current([...store.current.values()]);
      setVerifying(false);
      ctrl.current = null;
    }
  }

  const pct = verifying ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <>
      <div className="grid">
        <section className="panel reveal" style={{ ['--i' as any]: 1 }}>
          <h2><span className="no">01</span> Import</h2>
          <div
            className={`drop ${dragOver ? 'over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <b>Drop a CSV here</b>
            <span>or click to choose a file. Use a CSV exported from the Scrape tab, or any CSV with a Name column.</span>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          {importMsg && <p className={`msg ${importMsg.ok ? 'ok' : 'err'}`}>{importMsg.text}</p>}
          <div className="actions">
            <button className="btn" onClick={useScrape} disabled={verifying || !scrapeRows.length}>
              Use Scrape results ({scrapeRows.length.toLocaleString()})
            </button>
          </div>
          <p className="fine">
            Recognised columns: Name, Phone, Street/Address, City, State, ZIP, Website, Website status, Directory page, and the social links. The Website status column from this app's own exports is kept, so you can resume a half-finished check.
          </p>
        </section>

        <section className="panel reveal" style={{ ['--i' as any]: 2 }}>
          <h2><span className="no">02</span> Google Maps check</h2>
          <div className="stats">
            <div className="stat"><div className="n">{rows.length}</div><div className="l">Businesses</div></div>
            <div className="stat"><div className="n">{counts.nosite ?? 0}</div><div className="l">No website</div></div>
            <div className="stat"><div className="n">{recheck}</div><div className="l">To check</div></div>
            <div className="stat"><div className="n">{verifying ? progress.total - progress.done : 0}</div><div className="l">In queue</div></div>
          </div>
          <div className={`meter ${verifying ? 'live' : ''}`} aria-hidden><i style={{ width: `${pct}%` }} /></div>

          <div className="row2" style={{ marginTop: 0 }}>
            <div>
              <label className="field" htmlFor="ar" style={{ marginTop: 0 }}>Area (for members with no address)</label>
              <input id="ar" type="text" value={areaHint} onChange={(e) => setAreaHint(e.target.value)} placeholder={inferredArea || 'Christiansburg, VA'} disabled={verifying} />
            </div>
            <div>
              <label className="field" htmlFor="ml" style={{ marginTop: 0 }}>Max Google lookups</label>
              <input id="ml" type="number" min={1} max={1000} value={maxLookups} onChange={(e) => setMaxLookups(Number(e.target.value))} disabled={verifying} />
            </div>
          </div>
          <details className="adv">
            <summary>Chamber site &amp; ignore list</summary>
            <label className="field" htmlFor="ch">Chamber website(s)</label>
            <textarea
              id="ch"
              value={chamberText}
              onChange={(e) => setChamberText(e.target.value)}
              placeholder={(seedUrls.length ? seedUrls : inferredChamber).join('\n') || 'https://business.examplechamber.org/list'}
              spellCheck={false}
              disabled={verifying}
              style={{ minHeight: 56 }}
            />
            <span className="hint">A Google “website” that matches these (first 15 characters, or same domain) or redirects to them counts as no website. Defaults to your last crawl, or the member-page addresses in the CSV.</span>
            <label className="field" htmlFor="xp2">Also count as “no website”</label>
            <textarea id="xp2" value={extraPrefixes} onChange={(e) => setExtraPrefixes(e.target.value)} placeholder={'business.montgomerycc.org/list'} spellCheck={false} disabled={verifying} style={{ minHeight: 56 }} />
            <span className="hint">One per line. Permanent entries live in <code>src/lib/blocklist.ts</code>.</span>
          </details>

          <div className="actions">
            <button className="btn hot" onClick={runVerify} disabled={verifying || !recheck || googleConfigured === false}>
              {verifying ? `Checking ${progress.done}/${progress.total}…` : `Check ${toCheck.toLocaleString()} on Google Maps`}
            </button>
            <button className="btn ink" onClick={() => ctrl.current?.abort()} disabled={!verifying}>Stop</button>
          </div>
          {googleConfigured === false && <p className="fine">Add <code>GOOGLE_MAPS_API_KEY</code> to <code>.env.local</code> (Places API (New) enabled) and restart the server.</p>}
          <div style={{ marginTop: 14 }}>
            <LogView logs={logs} busy={verifying} empty="import a CSV to begin" />
          </div>
        </section>
      </div>

      {rows.length > 0 && <NoWebsitePanel kicker="03 · No website" counts={counts} value={siteFilter} onChange={setSiteFilter} />}

      <LedgerTable
        rows={rows}
        starredKeys={starredKeys}
        onToggleStar={onToggleStar}
        siteFilter={siteFilter}
        fileBase="google-check"
        title="Checked ledger"
        emptyTitle="No businesses loaded."
        emptyHint="Import a CSV above, or send results over from the Scrape tab."
      />
    </>
  );
});
