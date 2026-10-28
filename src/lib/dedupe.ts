import { EMPTY_BUSINESS, type BizDraft, type Business } from './types';

const SUFFIX = /\b(llc|l l c|inc|incorporated|co|corp|corporation|ltd|limited|pllc|pc|llp|lp|the)\b/g;

export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const digits = (s: string) => s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const zip5 = (s: string) => s.replace(/\s/g, '').slice(0, 5).toUpperCase();

/** Two records with the same name are only the same business if nothing contradicts that. */
function compatible(a: Business, b: Business): boolean {
  if (a.memberUrl && b.memberUrl && a.memberUrl !== b.memberUrl) return false;
  if (a.postalCode && b.postalCode && zip5(a.postalCode) !== zip5(b.postalCode)) return false;
  const pa = digits(a.phone);
  const pb = digits(b.phone);
  if (pa && pb && pa !== pb) return false;
  return true;
}

export function mergeInto(target: Business, src: BizDraft): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(src) as [keyof BizDraft, any][]) {
    if (k === '_orgOnly' || k === 'name') continue;
    if (k === 'categories') {
      const have = new Map(target.categories.map((c) => [c.toLowerCase(), c] as const));
      for (const c of (v as string[]) ?? []) {
        if (c && !have.has(c.toLowerCase())) {
          have.set(c.toLowerCase(), c);
          changed = true;
        }
      }
      target.categories = [...have.values()];
      continue;
    }
    if (v && !(target as any)[k]) {
      (target as any)[k] = v;
      changed = true;
    }
  }
  if (!target.name && src.name) {
    target.name = src.name;
    changed = true;
  }
  return changed;
}

/** Collects businesses and merges duplicates (same member page, or same name without conflicting details). */
export class BusinessStore {
  private items = new Map<string, Business>();
  private byMember = new Map<string, string>();
  private byName = new Map<string, string[]>();
  private seq = 0;
  duplicates = 0;

  get size() {
    return this.items.size;
  }

  all(): Business[] {
    return [...this.items.values()];
  }

  findByMemberUrl(url: string): Business | undefined {
    const id = this.byMember.get(url);
    return id ? this.items.get(id) : undefined;
  }

  /** Returns the stored business, whether it was new, and whether anything changed. */
  upsert(
    draft: BizDraft,
    opts: { allowNew: boolean; countDuplicate?: boolean },
  ): { business: Business; isNew: boolean; changed: boolean } | null {
    const name = (draft.name ?? '').trim();
    if (!name) return null;

    let existing: Business | undefined;
    if (draft.memberUrl) existing = this.findByMemberUrl(draft.memberUrl);

    const key = normName(name);
    if (!existing && key) {
      const probe = { ...EMPTY_BUSINESS, id: '', ...draft, name, categories: draft.categories ?? [] } as Business;
      for (const id of this.byName.get(key) ?? []) {
        const cand = this.items.get(id)!;
        if (compatible(cand, probe)) {
          existing = cand;
          break;
        }
      }
    }

    if (existing) {
      const changed = mergeInto(existing, draft);
      if (draft.memberUrl && !this.byMember.has(draft.memberUrl)) this.byMember.set(draft.memberUrl, existing.id);
      if (opts.countDuplicate !== false) this.duplicates++;
      return { business: existing, isNew: false, changed };
    }
    if (!opts.allowNew) return null;

    const b: Business = {
      ...EMPTY_BUSINESS,
      categories: [],
      ...stripInternal(draft),
      id: `b${++this.seq}`,
      name,
    };
    b.categories = [...new Set(b.categories)];
    this.items.set(b.id, b);
    if (b.memberUrl) this.byMember.set(b.memberUrl, b.id);
    if (key) this.byName.set(key, [...(this.byName.get(key) ?? []), b.id]);
    return { business: b, isNew: true, changed: true };
  }

  /**
   * Final clean-up: values that show up on many unrelated businesses (the chamber's own
   * phone, social pages, a shared web-host link, ...) are site chrome, not business data.
   */
  finalize(): Business[] {
    const list = this.all();
    if (list.length >= 6) {
      const fields = ['website', 'email', 'phone', 'facebook', 'instagram', 'linkedin', 'twitter'] as const;
      for (const f of fields) {
        const counts = new Map<string, number>();
        for (const b of list) {
          const v = f === 'phone' ? digits(b[f]) : b[f].toLowerCase();
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        for (const b of list) {
          const v = f === 'phone' ? digits(b[f]) : b[f].toLowerCase();
          if (v && (counts.get(v) ?? 0) >= 3) b[f] = '';
        }
      }
    }
    return list;
  }
}

export { digits as phoneDigits, zip5 };

function stripInternal(d: BizDraft): Omit<BizDraft, '_orgOnly'> {
  const { _orgOnly, ...rest } = d;
  void _orgOnly;
  // drop undefined/empty-string noise so defaults apply
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null)) as any;
}
