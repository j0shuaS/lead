'use client';

import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { COLUMNS, SITE_LABEL, STATUS_RANK, cellValue, hasValue, siteStatus, type ColumnKey } from '../lib/columns';
import { downloadBlob, downloadXlsx, stamp, toCsv, toJsonText } from '../lib/exporters';
import { shortLink } from '../lib/format';
import { bizKey } from '../lib/key';
import type { Business } from '../lib/types';
import { matchSite, type SiteFilter } from './NoWebsitePanel';

const FILTERABLE: ColumnKey[] = [
  'email', 'phone', 'street', 'city', 'region', 'postalCode', 'website',
  'description', 'categories', 'facebook', 'instagram', 'linkedin', 'twitter',
];
const LINK_COLS = new Set<ColumnKey>(['website', 'facebook', 'instagram', 'linkedin', 'twitter', 'googleMapsUrl', 'memberUrl']);
const PAGE_SIZE = 50;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Lower-cased searchable text per business, computed once per (immutable) business object.
const hayCache = new WeakMap<Business, string>();
function haystack(b: Business): string {
  let h = hayCache.get(b);
  if (h === undefined) {
    h = COLUMNS.map((c) => cellValue(b, c.key)).join(' ').toLowerCase();
    hayCache.set(b, h);
  }
  return h;
}

function Cell({ b, k }: { b: Business; k: ColumnKey }) {
  const v = cellValue(b, k);
  if (k === 'name') return <td className="name">{v}</td>;
  if (k === 'websiteCheck') {
    const s = siteStatus(b);
    return (
      <td>
        <span className={`badge s-${s}`}>{SITE_LABEL[s].replace(/^No website \((.*)\)$/, '$1').replace(/^No website$/, 'none')}</span>
      </td>
    );
  }
  if (!v) return <td><span className="none">—</span></td>;
  if (k === 'categories') return <td className="cats">{b.categories.map((x) => <span className="cat" key={x}>{x}</span>)}</td>;
  if (k === 'description') return <td className="desc" title={v}>{v.length > 180 ? v.slice(0, 179) + '…' : v}</td>;
  if (k === 'email') return <td><a href={`mailto:${v}`}>{v}</a></td>;
  if (k === 'googleMapsUrl') return <td><a href={v} target="_blank" rel="noreferrer noopener">open map ↗</a></td>;
  if (LINK_COLS.has(k)) return <td><a href={v} target="_blank" rel="noreferrer noopener" title={v}>{shortLink(v)}</a></td>;
  return <td className={k === 'phone' || k === 'postalCode' ? 'mono' : undefined} title={v}>{v}</td>;
}

const Row = memo(function Row({ b, starred, onToggle }: { b: Business; starred: boolean; onToggle: (b: Business) => void }) {
  return (
    <tr className={starred ? 'is-starred' : undefined}>
      <td className="star">
        <button
          className="starbtn"
          aria-pressed={starred}
          aria-label={starred ? `Unstar ${b.name}` : `Star ${b.name}`}
          title={starred ? 'Starred — click to remove' : 'Star this business'}
          onClick={() => onToggle(b)}
        >
          {starred ? '★' : '☆'}
        </button>
      </td>
      {COLUMNS.map((c) => <Cell key={c.key} b={b} k={c.key} />)}
    </tr>
  );
});

export const LedgerTable = memo(function LedgerTable({
  rows,
  starredKeys,
  onToggleStar,
  siteFilter = 'all',
  defaultSort = 'websiteCheck',
  fileBase,
  title = 'The ledger',
  emptyTitle = 'Nothing here yet.',
  emptyHint = '',
}: {
  rows: Business[];
  starredKeys: Set<string>;
  onToggleStar: (b: Business) => void;
  siteFilter?: SiteFilter;
  defaultSort?: ColumnKey | null;
  fileBase: string;
  title?: string;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [category, setCategory] = useState('');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [required, setRequired] = useState<Set<ColumnKey>>(new Set());
  const [sortKey, setSortKey] = useState<ColumnKey | null>(defaultSort);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState('');

  // typing stays instant; the (potentially big) filter/sort runs at lower priority
  const dq = useDeferredValue(query);
  const dcat = useDeferredValue(category);

  const regions = useMemo(() => [...new Set(rows.map((r) => r.region).filter(Boolean))].sort(), [rows]);
  const categories = useMemo(() => [...new Set(rows.flatMap((r) => r.categories))].sort(collator.compare).slice(0, 400), [rows]);

  const visible = useMemo(() => {
    const q = dq.trim().toLowerCase();
    const cat = dcat.trim().toLowerCase();
    let out = rows.filter((b) => {
      if (!matchSite(b, siteFilter)) return false;
      for (const k of required) if (!hasValue(b, k)) return false;
      if (region && b.region !== region) return false;
      if (cat && !b.categories.some((c) => c.toLowerCase().includes(cat))) return false;
      if (onlyStarred && !starredKeys.has(bizKey(b))) return false;
      if (q && !haystack(b).includes(q)) return false;
      return true;
    });
    if (sortKey) {
      if (sortKey === 'websiteCheck') out = [...out].sort((a, b) => (STATUS_RANK[siteStatus(a)] - STATUS_RANK[siteStatus(b)]) * sortDir);
      else out = [...out].sort((a, b) => collator.compare(cellValue(a, sortKey), cellValue(b, sortKey)) * sortDir);
    }
    return out;
  }, [rows, siteFilter, required, region, dcat, dq, onlyStarred, starredKeys, sortKey, sortDir]);

  useEffect(() => setPage(0), [siteFilter, required, region, dcat, dq, onlyStarred, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageRows = useMemo(() => visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [visible, page]);
  const filtersActive = required.size > 0 || !!region || !!category || !!query.trim() || siteFilter !== 'all' || onlyStarred;

  function toggleRequired(k: ColumnKey) {
    setRequired((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  function clearFilters() {
    setRequired(new Set());
    setRegion('');
    setCategory('');
    setQuery('');
    setOnlyStarred(false);
  }
  function sortBy(k: ColumnKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  }

  const name = (ext: string) => `lead-${fileBase}-${stamp()}.${ext}`;
  async function doXlsx() {
    setErr('');
    try {
      await downloadXlsx(visible, name('xlsx'));
    } catch (e: any) {
      setErr(`Excel export failed: ${e?.message ?? e}`);
    }
  }

  return (
    <section className="ledger">
      <div className="ledger-head">
        <h2>{title}</h2>
        <div className="count">
          <b>{visible.length.toLocaleString()}</b> shown{filtersActive ? ` of ${rows.length.toLocaleString()}` : ''}
        </div>
      </div>

      <div className="filters">
        <div className="filters-top">
          <div>
            <label className="label" htmlFor={`q-${fileBase}`}>Search</label>
            <input id={`q-${fileBase}`} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name, city, phone, anything…" />
          </div>
          <div>
            <label className="label" htmlFor={`rg-${fileBase}`}>State</label>
            <select id={`rg-${fileBase}`} value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">All</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`ct-${fileBase}`}>Category contains</label>
            <input id={`ct-${fileBase}`} type="text" list={`cats-${fileBase}`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. accounting" />
            <datalist id={`cats-${fileBase}`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <button className="linkbtn" onClick={clearFilters} disabled={!filtersActive}>reset filters</button>
          </div>
        </div>
        <div className="chips" role="group" aria-label="Only keep businesses that have…">
          <button className="chip star-chip" aria-pressed={onlyStarred} onClick={() => setOnlyStarred((v) => !v)}>★ starred only</button>
          <span className="kicker" style={{ margin: '0 4px 0 10px' }}>Must have</span>
          {FILTERABLE.map((k) => (
            <button key={k} className="chip" aria-pressed={required.has(k)} onClick={() => toggleRequired(k)}>
              {COLUMNS.find((c) => c.key === k)!.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="exports">
        <button className="btn" onClick={() => downloadBlob(new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' }), name('csv'))} disabled={!visible.length}>CSV</button>
        <button className="btn" onClick={doXlsx} disabled={!visible.length}>Excel</button>
        <button className="btn" onClick={() => downloadBlob(new Blob([toJsonText(visible)], { type: 'application/json' }), name('json'))} disabled={!visible.length}>JSON</button>
        <span className="note">
          exports the {visible.length.toLocaleString()} {filtersActive ? 'filtered ' : ''}row{visible.length === 1 ? '' : 's'} in the current order
        </span>
        {err && <span className="note" style={{ color: 'var(--err)' }}>{err}</span>}
      </div>

      <div className="tablewrap">
        {pageRows.length === 0 ? (
          <div className="empty-state">
            {rows.length === 0 ? emptyTitle : 'No businesses match those filters.'}
            <small>{rows.length === 0 ? emptyHint : 'Loosen a filter or reset them.'}</small>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="star" aria-label="Starred" />
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => sortBy(c.key)} aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
                    {c.label}
                    {sortKey === c.key && <span className="arr">{sortDir === 1 ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((b) => (
                <Row key={b.id} b={b} starred={starredKeys.has(bizKey(b))} onToggle={onToggleStar} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div className="pager">
          <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
          <span>page {page + 1} / {pageCount}</span>
          <button className="btn" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>Next →</button>
        </div>
      )}
    </section>
  );
});
