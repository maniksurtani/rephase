# Rephase

A mobile-first jet lag planner with a dark sleep theme, multi-destination itineraries, local storage, and optional Google account sync. The app runs its planner in the browser; a small Cloudflare Worker handles account persistence.

The first planner is an **evidence-informed rules prototype**. It is not a calibrated biological model or a clinically validated treatment. Large/uncertain shifts omit precise light and melatonin advice. The numerical optimizer and clinical review remain in [TODO.md](TODO.md).

## Quick local preview

Use Node.js 22.13 or newer (Node 24 is used for development).

```sh
cd /workspace/rephase
npm install
npm run dev
```

Open **http://localhost:5173** on the machine running the app. If this workspace is remote, forward port **5173** through your workspace/IDE first; a remote loopback address is not your device's localhost.

The sample London → Dubai connection → Singapore → San Francisco trip uses future dates relative to when you first open the app. It is clearly marked as an example, not actual flight data. Start a new trip or edit the sample, set your Profile preferences, and explore Your plan. Preferences/trips survive reload in IndexedDB.

Trip editing, planning, preferences, calendar/JSON export, and local saving work without Google credentials or a backend. The development server proxies `/api` to the optional Worker; without that server, Google/sync are unavailable and their controls explain configuration requirements.

Each flight includes travel class and actual lie-flat availability. Business class does not automatically imply a bed. In-flight rest excludes the first 30 minutes after takeoff and the final 60 minutes before landing; seated travel receives rest/nap guidance rather than a full-night sleep promise.

## Production bundle and offline preview

```sh
npm run build
npm run preview
```

Open **http://localhost:4173**. Production registers a service worker and precaches the complete static bundle. Let the first load finish online; then saved plans can be read/recalculated offline. The browser must support service workers/IndexedDB, and installation requires HTTPS or localhost. Dev mode intentionally does not install the service worker.

Use your browser's install/Add to Home Screen action where supported. Service-worker caching explicitly excludes the API, Google requests, and user data. Local private data is stored in an account-scoped IndexedDB namespace rather than a public asset cache.

## Optional local Worker and Google sync

No remote Cloudflare database or deployment is needed to test the local Worker:

```sh
cp .dev.vars.example .dev.vars
npm run build
npm run db:local
npm run worker:dev
```

Run `npm run dev` in a second terminal and continue using http://localhost:5173. Wrangler serves assets/API on http://localhost:8787; Vite provides the development UI and same-origin API proxy.

For real Google sign-in, create a Google OAuth **Web application** client and register `http://localhost:5173` as an authorized JavaScript origin. Put its public client ID in the ignored `.dev.vars` file:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
ALLOWED_ORIGIN="http://localhost:5173"
```

The ID-token sign-in flow needs no OAuth client secret and requests no Gmail/Calendar access. Restart Wrangler after configuration changes. Without a client ID, the Worker intentionally reports Google/sync as unavailable. Google end-to-end sign-in is not verified until a real client is configured.

Sign-in verifies Google tokens on the Worker and establishes an HttpOnly session. Choose cloud data, an existing account-local copy, or explicitly copy guest data. **Sync is manual in this version.** The revision counter is preserved locally across reload; concurrent changes produce a choice rather than silently overwriting another device. Signing out switches to the separate guest namespace. Cloud deletion leaves the local copy intact, and local clearing leaves cloud data intact.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser checks use Playwright against the production preview. Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; `/usr/bin/chromium` is used when available. Otherwise install Playwright's Chromium once with `npx playwright install chromium`.

Tests cover DST ambiguity, fractional timezones, date-line flights, itinerary/phase continuity, sleep/caffeine conflict checks, supplement opt-outs, calendar escaping, account-local storage, signed-token rejection, API ownership, session revocation, and stale-revision rejection. Browser checks exercise the app rather than relying only on TypeScript compilation.

Current verification: 46 unit/API tests pass, TypeScript and production build pass, all six Chromium browser scenarios have been verified, and local D1 migration/API smoke checks succeed. Browser sync tests use controlled API responses; real Google sign-in still needs a configured OAuth client. QA servers are stopped after verification; use the preview commands above to start your session.

## Repository

- [DESIGN.md](DESIGN.md): product, architecture, data model, science, authentication, offline behavior, and deployment boundary.
- [TODO.md](TODO.md): current implementation and future milestones.
- `src/App.tsx`, `src/styles.css`: responsive application UI.
- `src/lib/plan.ts`, `src/lib/time.ts`: versioned browser rules engine and temporal validation.
- `src/lib/store.ts`, `src/lib/auth.ts`: local storage and Worker integration.
- `worker/`, `migrations/`: minimal Google/session/state API and D1 schema.
- `scripts/build-offline.mjs`: production shell precache generation.
- `wrangler.jsonc`: prepared static-asset/Worker configuration, with a local-only placeholder D1 ID.

## Cloudflare later

No remote Cloudflare resources have been created or deployed. After discussing the account and domain, create D1, replace the placeholder database ID, apply remote migrations, set the production Google client ID/origin, and deploy the built Worker/static bundle. Register the final HTTPS origin with Google. A paid flight-data provider, push reminders, numerical optimizer, and validation are separate milestones.

Dynamic flight lookup and caching are listed in TODO.md with AeroDataBox as the recommended candidate for testing. AirLabs's near-term schedules and Skyscanner's booking searches do not satisfy known-flight lookup months ahead; Amadeus Self-Service was decommissioned. The live integration awaits provider access and coverage checks. Bun is also listed for optional development-tool benchmarking; the current commands remain verified Node/npm scripts.
