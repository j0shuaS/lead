# LEAD — Local Enterprise Acquisition Discovery

Finds local businesses that don't have a website listed on their Google
Business Profile, using the Google Places API (New) — and helps you
prioritize them once you've found them.

**Important distinction:** LEAD flags businesses with no `websiteUri` on their
Google listing. It does not — and can't — confirm a business has no website
anywhere on the internet. It's a starting point for outreach, not a guarantee.

## Features

- Search by typed location (ZIP, city, address) or by a **radius you draw
  on a map**, similar to Facebook Marketplace — search a place, then drag
  the circle to resize/move your search area.
- Flags businesses with **no website listed on Google**.
- For businesses that *do* have a website, runs a lightweight **quality
  check** on that site (reachable? mobile-friendly? just a Facebook page?
  parked/placeholder?) and shows a **Good / Okay / Bad** bar.
- A horizontal **stat/filter bar** — click a count to filter results by
  All / No website / Bad / Okay / Good.
- **Mark leads** (New / Contacted / Interested / Not interested / Closed)
  with notes. This is local to your browser session only — see note below.
- One-click **"Search on Google"** for a business name + address, and
  **"View on Maps"** for its listing.

## No database, on purpose

This build was tried with a Supabase-backed "save your leads" feature and
then deliberately reverted — there's currently no database. Lead status and
notes live in React state only and **reset on page refresh**. If you want
persistence back later, the natural place to add it is
`client/src/App.tsx`'s `handleStatusChange`, which is where a save call
would go.

## How it's built

- **`server/`** — Node.js + Express + TypeScript. The only thing that talks
  to Google; holds `GOOGLE_MAPS_API_KEY`. Endpoints:
  - `GET /api/search` — Places search (typed location or map radius)
  - `POST /api/quality-check` — runs the website quality heuristic for a
    batch of businesses
  - `server/src/app.ts` builds the Express app itself (no `.listen()`);
    `server/src/index.ts` is the local-dev entry that adds `.listen()`.
- **`client/`** — React + TypeScript + Vite + Tailwind CSS.
- **`api/index.ts`** — the same Express app from `server/src/app.ts`,
  exported directly instead of listening on a port. This is what runs on
  Vercel: one serverless function handling everything under `/api/*`. It
  exists so the exact same route/service code powers both local dev and
  the deployed version, with no duplication.
- **`middleware.ts`** (repo root) — the login gate. See **Login / access
  control** below.
- **`vercel.json`** (repo root) — tells Vercel to build `client/` as the
  static frontend and route `/api/*` to `api/index.ts`.

Two different Google API keys are involved, used very differently:
- **`GOOGLE_MAPS_API_KEY`** (backend, `server/.env`) — calls the Places API
  from the server. Never sent to the browser.
- **`VITE_GOOGLE_MAPS_API_KEY`** (frontend, `client/.env`) — loads the
  **Maps JavaScript API** in the browser to draw the interactive map. This
  one is *meant* to be public (it's how Google's map-embedding works) but
  should be restricted to your domain/localhost via HTTP referrer
  restrictions before deploying anywhere public. For local dev, you can
  point both env vars at the same key.

## Prerequisites

- **Node.js 18 or newer** (the backend uses the built-in `fetch`). Check
  with `node --version`.
- A Google Cloud project with:
  - **Places API (New)** enabled.
  - **Maps JavaScript API** enabled (for the radius map).
  - Billing enabled on the project.
  - An API key (reuse one for both env vars, or make two).

In [Google Cloud Console](https://console.cloud.google.com/): **APIs &
Services > Library** — search and **Enable** both "Places API (New)" and
"Maps JavaScript API". Then **APIs & Services > Credentials** for your key.

## Setup

From the project root (the folder containing this README):

```bash
npm install
npm run install:all
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Open `server/.env`:
```
GOOGLE_MAPS_API_KEY=your_actual_key_here
```

Open `client/.env`:
```
VITE_GOOGLE_MAPS_API_KEY=your_actual_key_here
```

Both `.env` files are already in `.gitignore`.

## Run it

```bash
npm run dev
```

- Backend at `http://localhost:8787`
- Frontend at `http://localhost:5173`

Open **http://localhost:5173**.

## Test it

- **Basic search:** Location `Christiansburg, VA`, Business type
  `restaurants`, click **Search for leads**.
- **Filter:** Click a cell in the stat bar above the results (e.g. "No
  website") to narrow the list to just that bucket.
- **Radius search:** Click **Search a specific area on the map**, search a
  place, then drag the circle's edge to resize or drag the circle itself
  to move it.
- **Mark a lead:** Change the status dropdown on any card and optionally
  add a note. Remember: this resets on refresh (see "No database" above).

## Design

Colors: Celadon `#AFD5AA` (good-website), White Smoke `#F0F2EF` (page
background), Stone Brown `#5C5346` (text), Silver `#A69F98` (secondary
text/neutral), Smoky Rose `#8C6057` (no-website / bad-website accent). The
"okay" tier uses a blend of Celadon and Smoky Rose so it visually sits
between the two. All defined in `client/tailwind.config.js`.

## A note on API cost

LEAD's Places field mask (`server/src/services/googlePlaces.ts`) only
requests fields it displays, but phone number, rating, and review count
fall under Google's pricier SKU tier. The website quality check makes a
plain HTTP request to each business's *own* site (not to Google) — separate
from Places pricing, but it does mean LEAD's server reaches out to
third-party websites; some may block or rate-limit that traffic.

## Troubleshooting

**"The server has no Google Maps API key configured"**
`server/.env` is missing or `GOOGLE_MAPS_API_KEY` is empty.

**HTTP 400/403 from Google on search**
Check the backend terminal — it now logs Google's exact error message.
Usually: Places API (New) not enabled, a key restriction blocking the
request, or billing not enabled.

**Map doesn't load / "Map search isn't available right now"**
`client/.env` is missing `VITE_GOOGLE_MAPS_API_KEY`, or the key doesn't
have **Maps JavaScript API** enabled. Check the browser console for the
specific Google error.

**Website quality bar stuck on "Checking…"**
The quality-check batch request likely failed — check the backend
terminal. Some sites also just time out; each gets 5 seconds before LEAD
gives up on it.

**Nothing happens / network error in the browser console**
Make sure both `npm run dev` processes are running — Vite proxies `/api`
to the backend at `localhost:8787`.

## How the website quality check works

`server/src/services/websiteQuality.ts` fetches each business's website and
scores it out of 100: does it respond at all, is it actually just a
redirect to Facebook/Instagram/Yelp/etc., does it look parked or "under
construction," does it have a page title and mobile viewport tag, is it
HTTPS, how much visible content is on the page. Score ≥70 is "Good," ≥40 is
"Okay," below that (or unreachable) is "Bad." **This is a heuristic, not a
real audit** — treat it as a fast triage signal, not a verdict.

## What's intentionally not in this build

A database/persistence layer, CSV export, email automation, user accounts,
pagination beyond one page of results, caching, and production deployment
config.

## Putting this on GitHub

From the project root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create an empty repo on GitHub (via [github.com/new](https://github.com/new),
or `gh repo create lead-app --private --source=. --remote=origin` if you have
the GitHub CLI installed), and push:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

`.env` files were never committed (they're in `.gitignore`) — double check
with `git status` before your first push that nothing named `.env` shows up.

## Deploying to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo
   you just pushed.
2. Leave **Root Directory** as the repo root (not `client/`) — `vercel.json`
   at the root already tells Vercel how to build the frontend and where the
   API function lives.
3. Before the first deploy (or right after, then redeploy), go to
   **Project Settings > Environment Variables** and add:
   - `GOOGLE_MAPS_API_KEY` — your backend Places API key
   - `VITE_GOOGLE_MAPS_API_KEY` — your frontend Maps JavaScript API key
     (this one gets baked into the build, so it must be set *before* you
     build/deploy, not just at runtime)
   - `BASIC_AUTH_PASSWORD` — see **Login / access control** below
4. Deploy. Once it's live, go back to **Project Settings > Environment
   Variables** if you added any of these after the first deploy, and
   redeploy from the **Deployments** tab so the new values take effect.

Every subsequent `git push` to `main` auto-deploys.

### Testing the Vercel shape locally (optional)

`npm run dev` (Vite + Express, proxied together) is fine for day-to-day
development, but it isn't *exactly* what runs on Vercel — the login gate in
`middleware.ts` and the single-function `api/index.ts` only run under
Vercel's own runtime. To test that shape locally:

```bash
npm i -g vercel
vercel dev
```

This reads env vars from a root-level `.env` (see `.env.example`) the same
way `vercel.json` expects them in production.

## Login / access control

The whole site — frontend and API alike — sits behind HTTP Basic Auth via
`middleware.ts`, which runs before any request reaches a page or the API.
Username is fixed as `admin`; the password comes from the
`BASIC_AUTH_PASSWORD` environment variable and is never stored in the repo.

Set it once in Vercel: **Project Settings > Environment Variables**, add
`BASIC_AUTH_PASSWORD` with your chosen value, for both **Production** and
**Preview** environments if you want preview deployments gated too.

To share access with someone, just give them the URL plus the username and
password — their browser will prompt for both on first visit. To revoke
access (e.g. after sharing it with someone temporarily), change the value
of `BASIC_AUTH_PASSWORD` in Vercel and redeploy; the old password stops
working immediately.

If `BASIC_AUTH_PASSWORD` isn't set at all, the site fails closed — nobody
gets in, including you — rather than accidentally becoming public.

