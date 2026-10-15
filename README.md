# Rephase

**Live app: [rephase.surtani.org](https://rephase.surtani.org)**

A mobile-first jet lag planner with a dark sleep theme, complex itineraries, Google-linked account storage, and flight-number/date lookup. Planning runs in the browser, including offline. A small Cloudflare Worker handles authentication, account persistence, and flight-provider requests. Guest planning works entirely on the device.

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

The London → Dubai connection → Singapore → San Francisco example uses relative future dates and is labeled as an example. Create a trip or edit it to make a personal itinerary. Profile controls habitual/preferred sleep, duration, chronotype, supplements, planning mode, and calendar reminders. Signed-in preferences and trips save to your account automatically after edits are committed.

Flight entry starts with a flight number and departure date. Find and confirm the matching flight, or choose **Enter manually** to reveal airports, local dates/times and timezones. Existing legs show their selected-flight summary and retain cabin choices; changing a lookup query requires a new confirmation or an explicit manual-entry choice before saving. Manual time inputs use HH:mm, with a blank arrival initially matching departure until adjusted. Verification and publication are recorded in TODO.md.

The planner has one airplane-window tile per date. Travel days have plane markers, explicit flight cards, and recommendation times in both origin and destination zones with local dates. Short flights remain visible even without a usable rest window.

Flight editing supports travel class and **separately confirmed** lie-flat availability. Unknown airborne times use 30-minute taxi allowances at each end, then exclude the first 30 minutes after takeoff and the final 60 before landing. Short flights may have no rest window. Crew instructions take priority. Airline class alone does not imply a bed.

Every flight includes a meal-service recommendation: protect planned rest by asking not to be woken, or use service while awake. Suggested meal windows fit around sleep, cabin restrictions, and connections, with both airport clocks. Service times are not known; windows are flexible, and meal calendar entries never have alarms. The [Science page](public/science.html#meals) explains the evidence and limits. Daily body-clock changes now compare successive simulated low points, with unavailable history labeled explicitly.

## Google sign-in and saved accounts

Local planning, manual trips, exports, and saved preferences work without credentials. The launcher creates an ignored `.dev.vars` with empty credentials if the file is absent. To test real Google sign-in, create an OAuth **Web application** client and register `http://localhost:5173` as an authorized JavaScript origin, then set:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
ALLOWED_ORIGIN="http://localhost:5173"
```

Restart the launcher after changes. Register `http://localhost:8787` too if testing production mode. This GIS ID-token flow needs no OAuth client secret and requests no Gmail or Calendar access.

Google’s official sign-in button opens Google’s account flow directly. Signed-in accounts load saved preferences and trips from Cloudflare D1 automatically, and committed edits save after a short debounce. There is no manual sync button, automatic-save toggle, or starting-data chooser. Your Google avatar opens a small account menu with Sign out; existing sessions gain an avatar after the next Google sign-in.

D1 is authoritative for signed-in accounts. IndexedDB retains an account-isolated offline copy and explicitly pending edits, so plans remain usable in flight and edits retry when connectivity returns while the app is open. Revisions and three-way merging protect edits from different devices; only genuine conflicts ask which version to keep. Cached identity never authorizes the API. Guest data stays separate and is never copied into an account automatically. A new account starts with default preferences and no trips. Older same-account edits merge automatically when a saved server baseline is known. Without that baseline, a one-time migration can retain personal preferences/trips only if D1 has no state and revision zero; example trips and guest data are excluded. Independent unsaved edits from multiple tabs remain recoverable, and overlapping edits require a choice. Clearing the offline copy leaves saved account data intact; deleting saved account data removes it from D1 and clears this device’s account copy. Other devices learn of deletion when they reconnect.

This fits Cloudflare’s free tier for personal use and an initial audience: D1 allows 500 MB per database, 5 GB per account, 5 million row reads/day and 100,000 row writes/day. Workers allow 100,000 dynamic requests/day on the free plan; static asset requests are free. Debounced account saves use a small shared database and do not write on every keystroke. These are limits, not an unlimited-storage promise; flight-provider quotas are separate. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Production has a Google client ID configured, and the owner has confirmed real sign-in. The simplified account experience, automatic saving and additive `0003_google_avatar.sql` migration are deployed; real-account acceptance of the revised flow is tracked in TODO.md.

## Optional flight lookup

The adapter uses **AeroDataBox through RapidAPI**, rather than discontinued Amadeus Self-Service, near-term AirLabs schedules, or Skyscanner route search. Subscribe on the [AeroDataBox pricing page](https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing); the Basic plan is for personal/noncommercial use and currently includes **400 API units/month**, not 400 requests. Production setup is documented step by step in [DEPLOYMENT.md](DEPLOYMENT.md#enable-aerodatabox-flight-lookup). For local development, put the key in the ignored `.dev.vars`:

```dotenv
RAPIDAPI_KEY="your-key"
```

Never commit keys or put them in browser configuration. Lookup requires a verified Google account and maps a flight number plus **departure-airport local date** to candidate schedules. Confirm your own booked/traveled flight before saving. Results remain editable and do not change your cabin choices. Future coverage is best effort; always compare with your booking.

The Worker caches normalized schedules with freshness timestamps, labels stale results, deduplicates concurrent requests within an isolate, and reserves daily/monthly/global request quotas before provider calls. Defaults: 10 provider requests per account/day, 40/month, and 150 globally/month. Airport metadata calls count too. The app’s outbound-request budgets are separate from AeroDataBox’s unit allowance: a single-date flight lookup currently costs two units, and airport metadata may consume additional units. Check the subscribed plan and RapidAPI usage dashboard before changing budgets. Shared cache retention is six days with hourly cleanup, below the seven-day limit. Owner-specific trip records are never reused as a shared cache. Provider attribution remains visible after manual edits to imported records.

The production key is not yet confirmed. Live route coverage at +60/+90/+150 days awaits a configured key and real-route acceptance; provider API fixtures are synthetic and do not prove future coverage. A separate [October 2026 itinerary regression](tests/fixtures/itineraries/oct2026.json) uses sourced, provisional third-party timetable times with explicit ambiguity/conflict notes.

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

Verified locally: frontend/Worker TypeScript, all 319 unit/model/API tests, production build, 23 account/planner Chromium scenarios plus the lookup-first regressions recorded in TODO.md, local D1/API/scheduled-handler smoke checks, launcher setup/shutdown, and real Wrangler dry-run bundling. The five-flight October itinerary, date-line transit days, unique date tiles, corrected modeled shifts, meal policies/windows, short flights, dual clocks, arrival defaults, and mobile layout have dedicated regressions. Meal tests cover missed/actual sleep logs and calendar exports without meal alarms. Production desktop/mobile, guest planner/calendar, Science without JavaScript, all 24 offline assets, offline behavior, and unauthenticated API rejection passed live smoke checks on 15 October 2026. The revised automatic account-saving flow still needs real-account acceptance after deployment; live lookup remains disabled until a provider key is configured. QA servers are stopped after verification.

For the independent numerical fixture reproduction, see [the kernel notes](src/lib/circadian/README.md). The airport source and optional Bun benchmark are documented in [DATA_SOURCES.md](DATA_SOURCES.md). `npm run benchmark:bun` reports honestly if Bun is absent; Node/npm remain the authoritative toolchain and lockfile.

## GitHub and Cloudflare

The code is synced to [maniksurtani/rephase](https://github.com/maniksurtani/rephase) on the `main` branch. The workspace has `origin` configured as `git@github.com:maniksurtani/rephase.git`, with `main` tracking `origin/main`. Production is deployed at https://rephase.surtani.org using a Worker Custom Domain, D1, static assets and an hourly cache-purge schedule.

For another checkout, inspect the remote helper:

```sh
npm run github:remote -- --help
```

[DEPLOYMENT.md](DEPLOYMENT.md) describes remote setup, the local/CI scripts, required Cloudflare/Google configuration, optional provider secret, and the deployment workflow. PR/main CI runs checks. Deployment supports manual dispatch and main-branch pushes when the repository variable `DEPLOY_ENABLED=true`; leaving it unset or false keeps deployment manual. The outstanding GitHub-runner Cloudflare challenge is documented in DEPLOYMENT.md.

[DESIGN.md](DESIGN.md) describes the architecture, scientific assumptions, API and storage contracts. [TODO.md](TODO.md) tracks completed implementation and external setup/research gates. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled licenses preserve attribution.
