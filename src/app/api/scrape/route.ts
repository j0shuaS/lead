import { crawl } from '../../../lib/crawler';
import { MIN_DELAY_MS } from '../../../lib/fetcher';
import type { ScrapeOptions } from '../../../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const clamp = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const urls: string[] = Array.isArray(body?.urls)
    ? body.urls.map(String)
    : String(body?.urls ?? '')
        .split(/[\s,]+/)
        .filter(Boolean);
  if (!urls.length) return Response.json({ error: 'Enter at least one directory URL.' }, { status: 400 });
  if (urls.length > 25) return Response.json({ error: 'Please submit 25 URLs or fewer at a time.' }, { status: 400 });

  const options: ScrapeOptions = {
    urls,
    maxResults: clamp(body?.maxResults, 1, 10_000, 200),
    followCategories: body?.followCategories !== false,
    openMemberPages: !!body?.openMemberPages,
    delayMs: clamp(body?.delayMs, MIN_DELAY_MS, 60_000, 1500),
    respectRobots: body?.respectRobots !== false,
    browser: ['off', 'auto', 'always'].includes(body?.browser) ? body.browser : 'off',
    emailMode: body?.emailMode === 'generic-only' ? 'generic-only' : 'named-first',
    maxPages: clamp(body?.maxPages, 1, 5000, 300),
    extraPrefixes: (Array.isArray(body?.extraPrefixes) ? body.extraPrefixes : []).map(String).filter(Boolean).slice(0, 100),
  };

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          /* client went away */
        }
      };
      try {
        for await (const ev of crawl(options, abort.signal, { allowPrivate: process.env.LEAD_ALLOW_PRIVATE === '1' })) {
          send(ev);
        }
      } catch (e: any) {
        send({ type: 'log', level: 'error', message: `Unexpected error: ${e?.message ?? e}` });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
