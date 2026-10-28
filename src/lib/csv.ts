import { COLUMNS, SITE_LABEL, type ColumnKey, type SiteStatus } from './columns';
import { EMPTY_BUSINESS, type Business, type WebsiteCheck } from './types';

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function detectDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r|\n|$/));
  let best = ',';
  let max = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let q = false;
    for (const ch of first) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    if (n > max) [best, max] = [d, n];
  }
  return best;
}

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF, BOM, ; or tab delimiters). */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, '');
  const delim = detectDelimiter(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/* ------------------------------------------------------------------ */
/* header mapping                                                      */
/* ------------------------------------------------------------------ */

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_MAP: Record<string, ColumnKey> = {};
for (const c of COLUMNS) {
  HEADER_MAP[norm(c.label)] = c.key;
  HEADER_MAP[norm(c.key)] = c.key;
}
Object.assign(HEADER_MAP, {
  businessname: 'name', company: 'name', companyname: 'name', member: 'name', membername: 'name', organization: 'name',
  emailaddress: 'email', mail: 'email',
  address: 'street', address1: 'street', addressline1: 'street', streetaddress: 'street',
  town: 'city', st: 'region', province: 'region', stateprovince: 'region',
  zip: 'postalCode', zipcode: 'postalCode', postcode: 'postalCode', postal: 'postalCode',
  telephone: 'phone', phonenumber: 'phone', tel: 'phone', mobile: 'phone',
  url: 'website', site: 'website', websiteurl: 'website', web: 'website', homepage: 'website',
  category: 'categories',
  x: 'twitter',
  googlemapsurl: 'googleMapsUrl', googlemapsuri: 'googleMapsUrl', maps: 'googleMapsUrl',
  memberpage: 'memberUrl', memberurl: 'memberUrl', profile: 'memberUrl',
  status: 'websiteCheck',
} satisfies Record<string, ColumnKey>);

const STATUS_BY_LABEL = new Map<string, SiteStatus>();
for (const [status, label] of Object.entries(SITE_LABEL) as [SiteStatus, string][]) {
  STATUS_BY_LABEL.set(norm(label), status);
  STATUS_BY_LABEL.set(norm(status), status);
}
const CHECK_VALUES: WebsiteCheck[] = ['found', 'confirmed-none', 'social-only', 'chamber-only', 'no-match', 'closed', 'error'];

/** Undo the leading apostrophe added on export to neutralise spreadsheet formulas. */
const unsafe = (v: string) => (/^'[=@+\-\t\r]/.test(v) ? v.slice(1) : v);

/** "123 Main St, Christiansburg, VA 24073" -> parts (for CSVs with one combined address column). */
function splitAddress(s: string): { street: string; city: string; region: string; postalCode: string } | null {
  const m = /^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)(?:,?\s*(?:USA|US|United States))?$/.exec(s.trim());
  return m ? { street: m[1].trim(), city: m[2].trim(), region: m[3].toUpperCase(), postalCode: m[4] } : null;
}

export interface CsvImport {
  rows: Business[];
  skipped: number;
  unknownColumns: string[];
}

/**
 * Turn a CSV (including one exported by this app) into businesses. Column names are matched
 * loosely ("ZIP", "Postal code", "zipcode" ...). Throws if no Name column can be found.
 */
export function csvToBusinesses(text: string, idPrefix = 'i'): CsvImport {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('The file has no data rows.');
  const header = table[0].map((h) => h.trim());
  const cols = header.map((h) => HEADER_MAP[norm(h)] as ColumnKey | undefined);
  if (!cols.includes('name')) {
    throw new Error('Could not find a "Name" column. The first row should be column headings such as Name, Phone, Website.');
  }
  const unknownColumns = header.filter((h, i) => h && !cols[i]);

  const rows: Business[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const b: Business = { ...EMPTY_BUSINESS, categories: [], id: '' };
    for (let c = 0; c < cols.length; c++) {
      const key = cols[c];
      const v = unsafe((cells[c] ?? '').replace(/\s+/g, ' ').trim());
      if (!key || !v) continue;
      if (key === 'categories') {
        if (!b.categories.length) b.categories = v.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      } else if (key === 'websiteCheck') {
        const st = STATUS_BY_LABEL.get(norm(v));
        b.websiteCheck = st && (CHECK_VALUES as string[]).includes(st) ? (st as WebsiteCheck) : '';
      } else if (!(b as any)[key]) {
        (b as any)[key] = v;
      }
    }
    if (!b.name) {
      skipped++;
      continue;
    }
    if (b.street && !b.city && !b.postalCode) {
      const a = splitAddress(b.street);
      if (a) Object.assign(b, a);
    }
    b.id = `${idPrefix}${rows.length + 1}`;
    rows.push(b);
  }
  return { rows, skipped, unknownColumns };
}
