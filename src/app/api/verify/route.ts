import { NO_WEBSITE_PREFIXES } from '../../../lib/blocklist';
import { PlacesError, verifyBusiness, type VerifyInput, type VerifyOutcome } from '../../../lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_PER_REQUEST = 1000;
const GAP_MS = 150; // ~6 lookups/second, well under Places API limits

const apiKey = () => process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '';

/** Lets the UI show whether the Google key is configured without exposing it. */
export async function GET() {
  return Response.json({ configured: !!apiKey() });
}

const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Body: { businesses: [{ id, name, street, city, region, postalCode, phone }] }
 * Streams NDJSON: { type: 'result', ...VerifyOutcome } | { type: 'progress' } | { type: 'log' } | { type: 'done' }
 */
export async function POST(req: Request) {
  const key = apiKey();
  if (!key) {
    return Response.json(
      { error: 'No Google API key configured. Add GOOGLE_MAPS_API_KEY to .env.local (Places API (New) must be enabled) and restart the server.' },
      { status: 400 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const list: VerifyInput[] = (Array.isArray(body?.businesses) ? body.businesses : [])
    .slice(0, MAX_PER_REQUEST)
    .map((b: any) => ({
      id: asStr(b?.id),
      name: asStr(b?.name),
      street: asStr(b?.street),
      city: asStr(b?.city),
      region: asStr(b?.region),
      postalCode: asStr(b?.postalCode),
      phone: asStr(b?.phone),
    }))
    .filter((b: VerifyInput) => b.id);
  if (!list.length) return Response.json({ error: 'No businesses to check.' }, { status: 400 });

  // The chamber's own site(s): a business "website" that matches or redirects to these doesn't count.
  const chamberUrls: string[] = (Array.isArray(body?.chamberUrls) ? body.chamberUrls : [])
    .map(asStr)
    .filter(Boolean)
    .slice(0, 25)
    .map((u: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`));

  const areaHint = asStr(body?.areaHint).slice(0, 80);

  // Always-on prefixes from src/lib/blocklist.ts plus any typed into the app for this run.
  const blockedPrefixes: string[] = [
    ...NO_WEBSITE_PREFIXES,
    ...(Array.isArray(body?.extraPrefixes) ? body.extraPrefixes : []).map(asStr).filter(Boolean).slice(0, 100),
  ];

  const abort = new AbortController();
  req.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
        } catch {
          /* client went away */
        }
      };
      const counts: Record<string, number> = {};
      let done = 0;
      let consecutiveErrors = 0;
      let stoppedEarly = false;
      let lackedArea = 0; // members with no address when no area was given

      try {
        for (const item of list) {
          if (abort.signal.aborted) {
            stoppedEarly = true;
            break;
          }
          if (!item.street && !item.city && !item.postalCode && !areaHint) lackedArea++;
          let outcome: VerifyOutcome;
          try {
            outcome = await verifyBusiness(item, { apiKey: key, signal: abort.signal, chamberUrls, blockedPrefixes, areaHint });
            consecutiveErrors = 0;
          } catch (e: any) {
            if (abort.signal.aborted) {
              stoppedEarly = true;
              break;
            }
            if (e instanceof PlacesError && e.fatal) {
              send({ type: 'log', level: 'error', message: e.message });
              stoppedEarly = true;
              break;
            }
            consecutiveErrors++;
            outcome = {
              id: item.id,
              check: 'error',
              website: '',
              googleMapsUrl: '',
              matchedName: '',
              matchedAddress: '',
              confidence: 0,
              social: {},
              reason: e?.message ?? 'Lookup failed.',
            };
            send({ type: 'log', level: 'warn', message: `${item.name}: ${outcome.reason}` });
            if (consecutiveErrors >= 5) {
              send({ type: 'log', level: 'error', message: 'Too many consecutive Google errors; stopping the check.' });
              send({ type: 'result', ...outcome });
              stoppedEarly = true;
              break;
            }
          }
          if (outcome.check === 'chamber-only' && outcome.reason) {
            send({ type: 'log', level: 'info', message: `${item.name}: ${outcome.reason}` });
          }
          counts[outcome.check] = (counts[outcome.check] ?? 0) + 1;
          done++;
          send({ type: 'result', ...outcome });
          send({ type: 'progress', done, total: list.length });
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
      } catch (e: any) {
        send({ type: 'log', level: 'error', message: `Unexpected error: ${e?.message ?? e}` });
      } finally {
        send({ type: 'done', done, total: list.length, counts, stoppedEarly, lackedArea });
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
