import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Tiny fake directory sites used by the self-test (no real websites are contacted). */

const layout = (title: string, body: string) => `<!doctype html><html><head><title>${title} | Example Chamber</title></head><body>
<header><nav><a href="/">Home</a></nav></header>
<main>${body}</main>
<footer>Example Chamber · (703) 555-9999 · <a href="https://www.facebook.com/examplechamber">Facebook</a> · <a href="mailto:chamber@examplechamber.test">chamber@examplechamber.test</a></footer>
</body></html>`;

const card = (id: number, slug: string, name: string, inner: string) =>
  `<div class="mn-card"><h3><a href="/list/member/${slug}-${id}">${name}</a></h3>${inner}<a class="btn" href="/list/member/${slug}-${id}">More info</a></div>`;

const PAGES: Record<string, string> = {
  '/robots.txt': 'User-agent: *\nDisallow: /list/ql/private-9\n',

  '/list': layout(
    'Directory',
    `<h1>Member Directory</h1>
     <ul>
       <li><a href="/list/ql/accounting-1">Accounting (3)</a></li>
       <li><a href="/list/ql/food-2">Food &amp; Dining (2)</a></li>
       <li><a href="/list/ql/private-9">Private (1)</a></li>
       <li><a href="/list/ql/missing-404">Ghost category</a></li>
       <li><a href="/list/searchalpha/a">A</a></li>
     </ul><!-- chambermaster -->`,
  ),

  '/list/ql/accounting-1': layout(
    'Accounting',
    `<h1>Accounting</h1>
     ${card(10, 'acme-accounting', 'Acme Accounting LLC',
       `<div>123 Main St<br>Springfield, VA 22150</div><div>Phone: (703) 555-0101</div>
        <a href="mailto:jane.doe@acmeaccounting.test">Email</a> <a href="http://acmeaccounting.test/">Website</a>`)}
     ${card(11, 'bob-cpa', 'Bob CPA',
       `<div>9 Oak Ave, Suite 4<br>Fairfax, VA 22030</div><div>703-555-0111</div>
        <a href="mailto:info@bobcpa.test">info@bobcpa.test</a> <a href="https://www.facebook.com/bobcpa">fb</a>`)}
     <a rel="next" href="/list/ql/accounting-1?pg=2">Next</a>`,
  ),
  '/list/ql/accounting-1?pg=2': layout(
    'Accounting p2',
    `<h1>Accounting</h1>
     ${card(13, 'carol-tax', 'Carol Tax Service', `<div>77 Elm Rd<br>Reston, VA 20190</div><div>(703) 555-0133</div>`)}`,
  ),

  '/list/ql/food-2': layout(
    'Food',
    `<h1>Food &amp; Dining</h1>
     ${card(10, 'acme-accounting', 'Acme Accounting LLC', `<div>123 Main St<br>Springfield, VA 22150</div>`)}
     ${card(12, 'joes-diner', "Joe's Diner",
       `<div>500 Market St<br>Alexandria, VA 22314</div><div>(703) 555-0122</div><a href="https://joesdiner.test">Visit website</a>`)}`,
  ),
  '/list/ql/private-9': layout('Private', `<h1>Private</h1>${card(99, 'secret-co', 'Secret Co', '')}`),
  '/list/searchalpha/a': layout('A', `<h1>A</h1>${card(10, 'acme-accounting', 'Acme Accounting LLC', '')}`),

  // member detail pages (microdata)
  '/list/member/acme-accounting-10': layout(
    'Acme Accounting LLC',
    `<h1>Acme Accounting LLC</h1>
     <div itemscope itemtype="http://schema.org/LocalBusiness">
       <span itemprop="name">Acme Accounting LLC</span>
       <div itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
         <span itemprop="streetAddress">123 Main St</span>, <span itemprop="addressLocality">Springfield</span>,
         <span itemprop="addressRegion">VA</span> <span itemprop="postalCode">22150</span></div>
       <span itemprop="telephone">(703) 555-0101</span>
       <p itemprop="description">Full-service accounting for small business in Northern Virginia.</p>
     </div>
     <a href="http://acmeaccounting.test/">Website</a>
     <a href="mailto:jane.doe@acmeaccounting.test">Email</a> <a href="mailto:info@acmeaccounting.test">Email</a>
     <a href="https://www.linkedin.com/company/acme-accounting">LinkedIn</a>
     <a href="https://twitter.com/acmeacct">X</a> <a href="https://www.instagram.com/acmeacct">IG</a>
     <div class="categories"><a href="/list/ql/accounting-1">Accounting</a></div>`,
  ),
  '/list/member/bob-cpa-11': layout('Bob CPA', `<h1>Bob CPA</h1><p>Taxes done right.</p><div>9 Oak Ave, Suite 4<br>Fairfax, VA 22030</div>`),
  '/list/member/carol-tax-13': layout('Carol Tax Service', `<h1>Carol Tax Service</h1><div>77 Elm Rd<br>Reston, VA 20190</div>`),
  '/list/member/joes-diner-12': layout('Joe\'s Diner', `<h1>Joe's Diner</h1><div>500 Market St<br>Alexandria, VA 22314</div><a href="mailto:hello@joesdiner.test">hello@joesdiner.test</a>`),

  // schema.org-only directory
  '/schema/directory': `<!doctype html><html><head><title>Members</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Example Chamber', url: 'http://HOST/', telephone: '703-555-9999', address: { '@type': 'PostalAddress', streetAddress: '1 Chamber Way', addressLocality: 'Springfield', addressRegion: 'VA', postalCode: '22150' } },
      { '@type': 'LocalBusiness', name: 'Maple Bakery', telephone: '+1 540 555 0100', email: 'orders@maplebakery.test', url: 'https://maplebakery.test', sameAs: ['https://www.facebook.com/maplebakery', 'https://instagram.com/maplebakery'], address: { '@type': 'PostalAddress', streetAddress: '4 Maple Ln', addressLocality: 'Roanoke', addressRegion: 'VA', postalCode: '24011' } },
      { '@type': 'Dentist', name: 'Bright Smiles Dental', telephone: '540-555-0199', address: '88 Gum St, Salem, VA 24153' },
    ],
  })}</script></head><body><h1>Members</h1></body></html>`,
};

export async function startFixtures(): Promise<{ base: string; close: () => Promise<void>; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    hits.push(url);
    const body = PAGES[url] ?? PAGES[url.split('?')[0]];
    if (!body || (url.includes('?') && !PAGES[url])) {
      res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>Not found</h1>');
      return;
    }
    const type = url === '/robots.txt' ? 'text/plain' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type }).end(body.replace(/HOST/g, String(server.address() ? (server.address() as AddressInfo).port : '')));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
