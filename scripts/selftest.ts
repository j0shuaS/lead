/**
 * End-to-end self-test against local fixture directories (nothing external is contacted).
 * Run with:  npm run selftest
 */
import assert from 'node:assert/strict';
import { crawl } from '../src/lib/crawler';
import { csvToBusinesses } from '../src/lib/csv';
import { toCsv } from '../src/lib/exporters';
import { extractPage } from '../src/lib/extract';
import { EMPTY_BUSINESS, type Business, type ScrapeEvent, type ScrapeOptions, type ScrapeStats } from '../src/lib/types';
import { PlacesError, isChamberUrl, matchesBlockedPrefix, verifyBusiness, type VerifyInput } from '../src/lib/places';
import { startFixtures } from './fixtures';

const base: Omit<ScrapeOptions, 'urls'> = {
  maxResults: 100,
  followCategories: true,
  openMemberPages: false,
  delayMs: 250,
  respectRobots: true,
  browser: 'off',
  emailMode: 'named-first',
  maxPages: 100,
};

async function run(opts: Partial<ScrapeOptions> & { urls: string[] }) {
  const logs: ScrapeEvent[] = [];
  let stats!: ScrapeStats;
  let businesses: Business[] = [];
  for await (const ev of crawl({ ...base, ...opts }, undefined, { allowPrivate: true })) {
    if (ev.type === 'log') logs.push(ev);
    if (ev.type === 'done') {
      stats = ev.stats;
      businesses = ev.businesses;
    }
  }
  const messages = logs.map((l) => (l.type === 'log' ? `${l.level}: ${l.message}` : ''));
  return { stats, businesses, messages };
}

const byName = (list: Business[], n: string) => list.find((b) => b.name === n)!;

async function main() {
  const fx = await startFixtures();
  let passed = 0;
  const ok = (name: string) => console.log(`  ✓ ${name}`) || passed++;

  try {
    console.log('ChamberMaster-style directory, categories + member pages');
    {
      const r = await run({ urls: [`${fx.base}/list`], openMemberPages: true });
      assert.equal(r.businesses.length, 4, `expected 4 businesses, got ${r.businesses.map((b) => b.name).join(', ')}`);
      ok('finds 4 unique businesses across categories and pagination');

      const acme = byName(r.businesses, 'Acme Accounting LLC');
      assert.equal(acme.street, '123 Main St');
      assert.equal(acme.city, 'Springfield');
      assert.equal(acme.region, 'VA');
      assert.equal(acme.postalCode, '22150');
      assert.equal(acme.phone, '(703) 555-0101');
      assert.equal(acme.website, 'http://acmeaccounting.test');
      assert.equal(acme.email, 'jane.doe@acmeaccounting.test', 'main listed contact preferred over info@');
      assert.match(acme.linkedin, /linkedin\.com\/company\/acme-accounting/);
      assert.match(acme.twitter, /twitter\.com\/acmeacct/);
      assert.match(acme.instagram, /instagram\.com\/acmeacct/);
      assert.ok(acme.description.includes('accounting'));
      ok('extracts all fields incl. socials from card + member page');

      assert.ok(acme.categories.includes('Accounting') && acme.categories.some((c) => c.startsWith('Food')), `categories: ${acme.categories}`);
      assert.ok(r.stats.duplicatesMerged >= 1);
      ok('dedupes a business listed in two categories and merges categories');

      assert.equal(byName(r.businesses, 'Bob CPA').email, 'info@bobcpa.test');
      assert.match(byName(r.businesses, 'Bob CPA').facebook, /facebook\.com\/bobcpa/);
      assert.equal(byName(r.businesses, 'Bob CPA').street, '9 Oak Ave, Suite 4');
      ok('falls back to generic email when no named one exists');

      assert.ok(r.businesses.every((b) => !/examplechamber/i.test(b.facebook + b.email)), 'chamber footer data must not leak');
      ok('ignores header/footer chrome (chamber email + Facebook)');

      assert.ok(!r.businesses.some((b) => b.name === 'Secret Co'));
      assert.equal(r.stats.robotsBlocked, 1);
      assert.ok(!fx.hits.includes('/list/ql/private-9'));
      ok('honors robots.txt');

      assert.ok(r.messages.some((m) => /not found/i.test(m)));
      ok('reports inaccessible pages (404) without crashing');
    }

    console.log('Options');
    {
      const r = await run({ urls: [`${fx.base}/list`], followCategories: false });
      assert.equal(r.businesses.length, 0);
      assert.ok(r.messages.some((m) => /Follow category pages/.test(m)));
      ok('category crawl off -> explains how to get members');

      const r2 = await run({ urls: [`${fx.base}/list`], maxResults: 2 });
      assert.equal(r2.businesses.length, 2);
      assert.equal(r2.stats.stoppedBy, 'max-results');
      ok('respects max results');

      const t0 = Date.now();
      await run({ urls: [`${fx.base}/list/ql/food-2`], followCategories: false, delayMs: 700 });
      assert.ok(Date.now() - t0 >= 700, 'delay between robots.txt and page request');
      ok('applies the configured request delay');
    }

    console.log('schema.org directory');
    {
      const r = await run({ urls: [`${fx.base}/schema/directory`] });
      assert.deepEqual(r.businesses.map((b) => b.name).sort(), ['Bright Smiles Dental', 'Maple Bakery']);
      const m = byName(r.businesses, 'Maple Bakery');
      assert.equal(m.postalCode, '24011');
      assert.equal(m.email, 'orders@maplebakery.test');
      assert.match(m.facebook, /facebook\.com\/maplebakery/);
      const d = byName(r.businesses, 'Bright Smiles Dental');
      assert.equal(d.city, 'Salem');
      assert.equal(d.region, 'VA');
      ok('parses JSON-LD LocalBusiness/Dentist, skips the chamber Organization');
    }

    console.log('CSV export / import round trip');
    {
      const base = { ...EMPTY_BUSINESS, categories: [] as string[] };
      const rows: Business[] = [
        { ...base, id: 'b1', name: 'Acme, "The Best" LLC', street: '1 Main St', city: 'Springfield', region: 'VA', postalCode: '22150', phone: '(703) 555-0101', description: 'Line one\nline two, with comma', categories: ['Accounting', 'Tax'], website: '', websiteCheck: 'confirmed-none', memberUrl: 'https://business.montgomerycc.org/list/member/acme-1', googleMapsUrl: 'https://maps.google.com/?cid=1' },
        { ...base, id: 'b2', name: '=HYPERLINK("http://evil")', phone: '+1 540 555 0100', website: 'https://realco.com' },
      ];
      const text = toCsv(rows);
      assert.ok(text.includes("'=HYPERLINK"), 'formula-looking values are neutralised in exports');
      const back = csvToBusinesses(text, 'g');
      assert.equal(back.rows.length, 2);
      const a = back.rows[0];
      assert.equal(a.name, 'Acme, "The Best" LLC');
      assert.equal(a.postalCode, '22150');
      assert.deepEqual(a.categories, ['Accounting', 'Tax']);
      assert.equal(a.websiteCheck, 'confirmed-none', 'Website status survives the round trip');
      assert.equal(a.memberUrl, rows[0].memberUrl);
      assert.equal(back.rows[1].name, '=HYPERLINK("http://evil")', 'apostrophe guard is removed on import');
      assert.equal(back.rows[1].phone, '+1 540 555 0100');
      assert.equal(back.rows[1].website, 'https://realco.com');
      ok('exported CSV re-imports with fields, categories and Google status intact');

      const loose = csvToBusinesses('Business Name;ZIP;Telephone;Address\nZed Co;24060;540-555-0000;"9 Elm St, Blacksburg, VA 24060"\n,,,\n', 'g');
      assert.equal(loose.rows.length, 1);
      assert.equal(loose.rows[0].city, 'Blacksburg');
      assert.equal(loose.rows[0].street, '9 Elm St');
      assert.throws(() => csvToBusinesses('Foo,Bar\n1,2\n'), /Name/);
      ok('loose headers, ; delimiter and a combined address column are understood');
    }

    console.log('Chamber links are never a business website');
    {
      // The directory lives on www.montgomerycc.org but member pages are on business.montgomerycc.org.
      const html = `<html><body><main>
        <div class="card"><h3><a href="https://business.montgomerycc.org/list/member/345-landscaping-1">345 Landscaping</a></h3>
        <div>1 Main St<br>Christiansburg, VA 24073</div><a href="tel:5408189156">call</a></div>
        <div class="card"><h3><a href="https://business.montgomerycc.org/list/member/real-co-2">Real Co</a></h3>
        <div>2 Main St<br>Blacksburg, VA 24060</div><a href="https://realco.com/">Website</a></div>
      </main></body></html>`;
      const ex = extractPage(html, 'https://www.montgomerycc.org/directory', 'named-first');
      const a = ex.drafts.find((d) => d.name === '345 Landscaping')!;
      const b = ex.drafts.find((d) => d.name === 'Real Co')!;
      assert.ok(a && !a.website, `chamber member-page link must not become the website, got "${a?.website}"`);
      assert.equal(b.website, 'https://realco.com');
      assert.ok(isChamberUrl('https://business.montgomerycc.org/list/member/x', ['https://www.montgomerycc.org/directory']));
      ok('links to the chamber\'s own member pages (even on another subdomain) are ignored; real sites kept');
    }

    console.log('Google verification (stubbed Places API, no network)');
    {
      const CHAMBER = ['https://business.examplechamber.org/list'];
      assert.ok(isChamberUrl('https://business.examplechamber.org/list/member/acme-10', CHAMBER));
      assert.ok(isChamberUrl('http://www.business.examplechamber.org', CHAMBER), 'first 15 chars match, scheme/www ignored');
      assert.ok(isChamberUrl('https://examplechamber.org/', CHAMBER), 'same registrable domain');
      assert.ok(!isChamberUrl('https://acmeaccounting.test', CHAMBER));
      assert.ok(isChamberUrl('https://abc.org/members', ['https://abc.org']));
      assert.ok(!isChamberUrl('https://abc.organics.com', ['https://abc.org']), 'short chamber host needs a boundary');
      ok('chamber URL rule: first 15 characters / same domain');

      const member: VerifyInput = { id: 'b1', name: 'Acme Accounting LLC', street: '123 Main St', city: 'Springfield', region: 'VA', postalCode: '22150', phone: '(703) 555-0101' };
      const stub = (website: string | undefined, redirects: Record<string, string> = {}, name = 'Acme Accounting', addr = '123 Main St, Springfield, VA 22150, USA'): typeof fetch =>
        (async (input: any) => {
          const url = String(input);
          if (url.includes('places.googleapis.com')) {
            const place: any = { id: 'p1', displayName: { text: name }, formattedAddress: addr, googleMapsUri: 'https://maps.google.com/?cid=1' };
            if (website) place.websiteUri = website;
            return new Response(JSON.stringify({ places: [place] }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          if (redirects[url]) return new Response(null, { status: 301, headers: { location: redirects[url] } });
          return new Response('<html></html>', { status: 200 });
        }) as typeof fetch;
      const verify = (website: string | undefined, extra: Record<string, string> = {}, name?: string, addr?: string) =>
        verifyBusiness(member, { apiKey: 'k', fetchImpl: stub(website, extra, name, addr), chamberUrls: CHAMBER, allowPrivate: true });

      assert.equal((await verify('https://acmeaccounting.com')).check, 'found');
      assert.equal((await verify('https://acmeaccounting.com')).website, 'https://acmeaccounting.com');
      ok('real website on Google -> found (website filled in)');

      assert.equal((await verify(undefined)).check, 'confirmed-none');
      ok('no website on Google -> confirmed no website');

      assert.equal((await verify('https://www.facebook.com/acmeaccounting')).check, 'social-only');
      ok('Facebook page only -> still no website');

      const direct = await verify('https://business.examplechamber.org/list/member/acme-accounting-10');
      assert.equal(direct.check, 'chamber-only');
      assert.equal(direct.website, '');
      ok('website that is the chamber site -> counts as no website');

      const redirected = await verify('https://acme-short.test/go', { 'https://acme-short.test/go': 'https://www.business.examplechamber.org/list/member/acme-accounting-10' });
      assert.equal(redirected.check, 'chamber-only');
      ok('website that redirects to the chamber site -> counts as no website');

      const prefixed = await verifyBusiness(member, {
        apiKey: 'k',
        fetchImpl: stub('https://business.montgomerycc.org/list/member/acme-10'),
        blockedPrefixes: ['business.montgomerycc.org/list'],
        allowPrivate: true,
      });
      assert.equal(prefixed.check, 'chamber-only');
      assert.ok(matchesBlockedPrefix('http://www.business.montgomerycc.org/list', ['business.montgomerycc.org/list/']));
      assert.ok(!matchesBlockedPrefix('https://business.montgomerycc.org/listings', ['business.montgomerycc.org/list']));
      assert.ok(!matchesBlockedPrefix('https://business.montgomerycc.org/', ['business.montgomerycc.org/list']));
      ok('custom prefix (business.montgomerycc.org/list) counts as no website, respecting path boundaries');

      assert.equal((await verify('https://acmeaccounting.com', { 'https://acmeaccounting.com': 'https://www.acmeaccounting.com/home' })).check, 'found');
      ok('redirect to the business\'s own domain is still a real website');

      assert.equal((await verify('https://other.com', {}, 'Zed Plumbing', '1 Far Rd, Tucson, AZ 85701, USA')).check, 'no-match');
      ok('different business at a different address is not accepted as a match');

      // Members with no address on the directory (as with many ChamberMaster list cards)
      const noAddr: VerifyInput = { ...member, street: '', city: '', region: '', postalCode: '' };
      const onePlace = (async () =>
        new Response(
          JSON.stringify({ places: [{ id: 'p', displayName: { text: 'Acme Accounting' }, formattedAddress: '5 Elm St, Springfield, VA 22150, USA', nationalPhoneNumber: '(703) 555-0101' }] }),
          { status: 200 },
        )) as unknown as typeof fetch;
      assert.equal((await verifyBusiness(noAddr, { apiKey: 'k', fetchImpl: onePlace })).check, 'confirmed-none');
      ok('no address, matching phone number -> matched and checked');
      const noPhone = { ...noAddr, phone: '' };
      assert.equal((await verifyBusiness(noPhone, { apiKey: 'k', fetchImpl: onePlace, areaHint: 'Springfield, VA' })).check, 'confirmed-none');
      assert.equal((await verifyBusiness(noPhone, { apiKey: 'k', fetchImpl: onePlace, areaHint: 'Tucson, AZ' })).check, 'no-match');
      assert.equal((await verifyBusiness(noPhone, { apiKey: 'k', fetchImpl: onePlace })).check, 'no-match');
      ok('no address or phone -> matched by name inside the chosen area only');

      const failing = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 })) as unknown as typeof fetch;
      await assert.rejects(verifyBusiness(member, { apiKey: 'bad', fetchImpl: failing }), (e: any) => e instanceof PlacesError && e.fatal);
      ok('bad key / disabled API is reported as a fatal error');
    }

    console.log('Error handling');
    {
      const r = await run({ urls: ['not a url', 'ftp://example.com/x', `${fx.base}/nope`] });
      assert.equal(r.businesses.length, 0);
      assert.ok(r.stats.errors >= 3);
      assert.ok(r.messages.some((m) => /Invalid URL/.test(m)));
      ok('invalid URLs and a dead page are reported');

      const r2 = await run({ urls: [`${fx.base}/robots.txt`] });
      assert.equal(r2.businesses.length, 0);
      ok('non-directory page -> unsupported / no results, no crash');

      const r3 = await run({ urls: ['http://localhost:9/'] });
      // allowPrivate is on for tests, so this fails as a network error rather than a block
      assert.equal(r3.businesses.length, 0);
      ok('unreachable host fails cleanly');
    }
  } finally {
    await fx.close();
  }
  console.log(`\n${passed} checks passed`);
}

main().catch((e) => {
  console.error('\nSELFTEST FAILED\n', e);
  process.exit(1);
});
