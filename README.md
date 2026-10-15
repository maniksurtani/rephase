# Rephase

**Live app: [rephase.surtani.org](https://rephase.surtani.org)**

A mobile-first jet lag planner with a dark sleep theme, complex itineraries, optional Google sync, and flight-number/date lookup. Planning runs in the browser, including offline. A small Cloudflare Worker handles authentication, optional persistence, and flight-provider requests.

The default experimental planner uses the published Forger99 light-driven circadian model and compares constrained advance/delay schedules across the itinerary. Its equations have been checked against an independent Python/SciPy reference. **Numerical verification is not clinical validation:** personal phase, received light, and actual sleep remain uncertain. Conservative planning rules are also available in Profile. Read the standalone [Science page](public/science.html) at `/science.html` for plain-language explanations and original sources.

## Start locally

Use Node.js **22.13 or newer**; Node 24 is used for development. From this repository:

```sh
npm start
```

The [launcher](scripts/launch.mjs) installs locked dependencies when missing, builds outdated assets, applies **local** D1 migrations, starts Vite and the local Worker, and opens **http://localhost:5173**. Press **Ctrl+C** to stop its servers. It preserves existing `.dev.vars` and refuses occupied ports.

Useful alternatives:

```sh
npm start -- --static        # Browser-only development; no Worker or D1
npm start -- --production    # Built offline app and local API on localhost:8787
npm start -- --no-open       # Do not open a browser automatically
npm start -- --help
```

If this workspace is remote, forward port **5173** (or **8787** in production mode) through your IDE/workspace. The remote machine's loopback address is not your device's localhost.

The London → Dubai connection → Singapore → San Francisco example uses relative future dates and is labeled as an example. Create a trip or edit it to make a personal itinerary. Profile controls habitual/preferred sleep, duration, chronotype, supplements, planning mode, calendar reminders, and optional automatic sync.

Flight inputs use HH:mm, with a blank arrival initially matching departure until you adjust it. The planner has one airplane-window tile per date. Travel days have plane markers, explicit flight cards, and recommendation times in both origin and destination zones with local dates. Short flights remain visible even without a usable rest window.

Flight editing supports travel class and **separately confirmed** lie-flat availability. Unknown airborne times use 30-minute taxi allowances at each end, then exclude the first 30 minutes after takeoff and the final 60 before landing. Short flights may have no rest window. Crew instructions take priority. Airline class alone does not imply a bed.

Every flight includes a meal-service recommendation: protect planned rest by asking not to be woken, or use service while awake. Suggested meal windows fit around sleep, cabin restrictions, and connections, with both airport clocks. Service times are not known; windows are flexible, and meal calendar entries never have alarms. The [Science page](public/science.html#meals) explains the evidence and limits. Daily body-clock changes now compare successive simulated low points, with unavailable history labeled explicitly.

## Google sign-in and account sync

Local planning, manual trips, exports, and saved preferences work without credentials. The launcher creates an ignored `.dev.vars` with empty credentials if the file is absent. To test real Google sign-in, create an OAuth **Web application** client and register `http://localhost:5173` as an authorized JavaScript origin, then set:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
ALLOWED_ORIGIN="http://localhost:5173"
```

Restart the launcher after changes. Register `http://localhost:8787` too if testing production mode. This GIS ID-token flow needs no OAuth client secret and requests no Gmail or Calendar access.

Guest and account storage remain separate. First sign-in offers an explicit choice before copying guest data into an account. Sync uses revisions and a persisted three-way merge base: separate edits can merge; conflicting edits require a choice. Automatic sync is opt-in. Cached offline identity never authorizes the API. Clearing local data and deleting cloud data are distinct operations; account copies can persist on other devices until those devices sync or clear them.

Production has a Google client ID configured. Complete a real Google sign-in and save/reload a synced trip to verify account behavior end to end; this has not been tested using a real account.

## Optional flight lookup

The adapter uses **AeroDataBox through RapidAPI**, rather than discontinued Amadeus Self-Service, near-term AirLabs schedules, or Skyscanner route search. Subscribe to a suitable plan and put the key in `.dev.vars`:

```dotenv
RAPIDAPI_KEY="your-key"
```

Never commit keys or put them in browser configuration. Lookup requires a verified Google account and maps a flight number plus **departure-airport local date** to candidate schedules. Confirm your own booked/traveled flight before saving. Results remain editable and do not change your cabin choices. Future coverage is best effort; always compare with your booking.

The Worker caches normalized schedules with freshness timestamps, labels stale results, deduplicates concurrent requests within an isolate, and reserves daily/monthly/global request quotas before provider calls. Defaults: 10 provider requests per account/day, 40/month, and 150 globally/month. Airport metadata calls count too. AeroDataBox's free plan is for noncommercial use; check current plan limits and terms before enabling it. Shared cache retention is six days with hourly cleanup, below the seven-day limit. Owner-specific trip records are never reused as a shared cache. Provider attribution remains visible after manual edits to imported records.

Live route coverage at +60/+90/+150 days awaits your key; provider API fixtures are synthetic and do not prove future coverage. A separate [October 2026 itinerary regression](tests/fixtures/itineraries/oct2026.json) uses sourced, provisional third-party timetable times with explicit ambiguity/conflict notes.

## Offline and calendar export

```sh
npm run build
npm run preview
```

Open **http://localhost:4173**. Let the first online load finish to install the service worker. The app, planning worker, fonts, airport data, and Science page are precached; API/account responses and Google requests are excluded. Saved trips can then generate plans offline. Installation requires HTTPS or localhost and browser support for IndexedDB/service workers. Development mode does not register a service worker.

Calendar export uses UTC instants, stable IDs, and optional reminders ten minutes before actions. Contiguous midnight-split actions are combined to avoid a second sleep alarm. Calendar applications decide whether imported alarms are honored. JSON export provides a backup; browser storage may be cleared or evicted.

## Checks

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:e2e
```

Playwright uses `/usr/bin/chromium` when present, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; otherwise install it with `npx playwright install chromium`. Engineering checks cover numerical reference trajectories, temporal/itinerary constraints, adherence replay, daylight, API ownership/nonce/session/revision security, cache/quotas, sync merges, calendar export, and deployment/launcher configuration. Browser checks use controlled API responses for account and flight scenarios.

Verified locally: frontend/Worker TypeScript, all 238 unit/model/API tests, production build, 15 Chromium scenarios, local D1/API/scheduled-handler smoke checks, launcher setup/shutdown, and real Wrangler dry-run bundling. The five-flight October itinerary, date-line transit days, unique date tiles, corrected modeled shifts, meal policies/windows, short flights, dual clocks, arrival defaults, and mobile layout have dedicated regressions. Meal tests cover missed/actual sleep logs and calendar exports without meal alarms. Production desktop/mobile, guest planner/calendar, Science without JavaScript, all 24 offline assets, offline behavior, and unauthenticated API rejection passed live smoke checks on 15 October 2026. Real Google account sync still needs user verification; live lookup remains disabled until a provider key is configured. QA servers are stopped after verification.

For the independent numerical fixture reproduction, see [the kernel notes](src/lib/circadian/README.md). The airport source and optional Bun benchmark are documented in [DATA_SOURCES.md](DATA_SOURCES.md). `npm run benchmark:bun` reports honestly if Bun is absent; Node/npm remain the authoritative toolchain and lockfile.

## GitHub and Cloudflare

The code is synced to [maniksurtani/rephase](https://github.com/maniksurtani/rephase) on the `main` branch. The workspace has `origin` configured as `git@github.com:maniksurtani/rephase.git`, with `main` tracking `origin/main`. Production is deployed at https://rephase.surtani.org using a Worker Custom Domain, D1, static assets and an hourly cache-purge schedule.

For another checkout, inspect the remote helper:

```sh
npm run github:remote -- --help
```

[DEPLOYMENT.md](DEPLOYMENT.md) describes remote setup, the local/CI scripts, required Cloudflare/Google configuration, optional provider secret, and the deployment workflow. PR/main CI runs checks; deployment is manual initially. Automatic main-branch deployment can be enabled after the first verified release.

[DESIGN.md](DESIGN.md) describes the architecture, scientific assumptions, API and storage contracts. [TODO.md](TODO.md) tracks completed implementation and external setup/research gates. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled licenses preserve attribution.
