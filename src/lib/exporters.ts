import { COLUMNS, SITE_LABEL, cellValue, siteStatus } from './columns';
import type { Business } from './types';

export const stamp = () => new Date().toISOString().slice(0, 10);

/** Neutralise spreadsheet formulas (=, @, +x, -x) in values that came from the web. */
function safe(v: string): string {
  return /^[=@\t\r]/.test(v) || /^[+-][^\d\s(]/.test(v) ? `'${v}` : v;
}

const esc = (v: string) => {
  const s = safe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Business[]): string {
  const head = COLUMNS.map((c) => esc(c.label)).join(',');
  const body = rows.map((b) => COLUMNS.map((c) => esc(cellValue(b, c.key))).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}

export function toJsonText(rows: Business[]): string {
  return JSON.stringify(
    rows.map((b) => {
      const o: Record<string, unknown> = {};
      for (const c of COLUMNS) o[c.key] = b[c.key];
      o.websiteStatus = SITE_LABEL[siteStatus(b)];
      return o;
    }),
    null,
    2,
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadXlsx(rows: Business[], filename: string) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  downloadBlob(await res.blob(), filename);
}
