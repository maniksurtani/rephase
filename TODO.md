# Rephase build tasks

Updated 2026-10-15. Checked items record completed implementation; verification status for each release is recorded below. External credentials, publication, and clinical/outcome research are separate gates; they cannot be completed by local tests.

## Foundation and design

- [x] Create a new Git repository on `main` at `/workspace/rephase`.
- [x] Document product, architecture, domain/API contracts, scientific assumptions, and deployment boundaries in DESIGN.md.
- [x] Build the TypeScript/React/Vite app with locked dependencies and local fonts/licenses.
- [x] Document preview, source provenance, setup, and supporting scripts.

## Planner and science

- [x] Support complex ordered itineraries, connections, destination stays, partial/home strategies, and returns.
- [x] Validate UTC chronology, fractional offsets, date-line crossings, DST gaps, and explicitly selected repeated clocks.
- [x] Preserve the conservative rules engine as an optional planning mode.
- [x] Port the published Forger99 reference with unchanged parameters and MIT attribution.
- [x] Independently reproduce reference trajectories with upstream Python/SciPy; check RK4 agreement and timestep convergence.
- [x] Compare constrained advance/delay candidates across the whole itinerary with continuous oscillator state and bounded search.
- [x] Separate actual habitual bed/wake duration from requested future sleep duration; avoid invented chronotype offsets.
- [x] Keep partial-adjustment targets fixed through preparation and their associated stay.
- [x] Compute destination daylight/polar feasibility and identify indoor/unknown light requirements.
- [x] Protect gate/airborne/transfer constraints: estimated taxi allowances, first 30 minutes after takeoff, final 60 before landing.
- [x] Take travel class and separately confirmed lie-flat availability into account without inventing seat-specific phase rates.
- [x] Add optional caffeine windows and conservative, acknowledged melatonin timing/general dose information.
- [x] Record actual completed/missed/partial experience, replay uncertain light/sleep history, and replan future guidance in model mode.
- [x] Run planning in a browser Web Worker and cancel obsolete calculations.
- [x] Add a static mobile Science page with authoritative sources, easy explanations, and clear numerical/clinical limits.

## App, data, and authentication

- [x] Build dark mobile/desktop Today, Plan, Trips, and Profile views with clearly labeled example data.
- [x] Implement itinerary editing, cabin/airborne inputs, preferences, loading/error states, and accessible controls.
- [x] Bundle 7,884 global IATA airports with zones/coordinates, capped suggestions, attribution, and reproducible updates.
- [x] Persist validated account-separated IndexedDB state and render device data before network responses.
- [x] Provide local/cloud data deletion and JSON export.
- [x] Export UTC calendars with optional reminders and merged midnight continuations.
- [x] Precache the static app, planning worker, fonts, airport data, and Science page while excluding private APIs.
- [x] Implement Google GIS and Worker signature/audience/issuer/expiry/nonce verification with hashed revocable sessions.
- [x] Enforce ownership, expected-account headers, same-origin mutations, payload limits, and optimistic revisions.
- [x] Persist atomic sync snapshots; merge independent preference/trip/leg edits and preserve conflicting/in-flight changes.
- [x] Automatically save verified account edits with bounded retries and offline caching; preserve deletion tombstones and account reauthentication boundaries.

## Account experience and automatic saving

- [x] Replace the verbose application sign-in popup with Google’s official sign-in button opening Google directly.
- [x] Show the verified Google avatar in the header, with a compact account menu containing Sign out and a fallback for missing images.
- [x] Verify real Google button embeds at desktop/mobile sizes and remove white iframe canvases caused by the surrounding dark color scheme; keep Google's official button styling.
- [x] Remove the cluttered signed-in panel, redundant signed-in/repeat-sign-in labels, manual sync button and automatic-sync toggle.
- [x] Load D1 account preferences/trips automatically, with no starting-data chooser; new accounts start empty and guest data never imports automatically.
- [x] Reconcile older same-account edits against their saved baseline; restrict unknown-baseline personal-data migration to never-initialized D1 accounts, excluding guest/demo data and retaining deletion tombstones.
- [x] Automatically debounce committed account edits, retain atomic offline pending edits/baselines, merge independent device changes and ask only about genuine conflicts.
- [x] Reverify sessions, isolate account namespaces, refresh on reconnect/focus, retry transient failures and retain offline planning.
- [x] Preserve recoverable multi-tab draft journals through transactional generation-aware writes; merge independent drafts without regressing server revisions or discarding unseen edits during review/deletion.
- [x] Rebase unsaved Profile fields over same-account updates and reset drafts on account switches.
- [x] Renew unused Google challenges without rotating their nonce, serialize acquisition with Web Locks when supported and retain one-use verification.
- [x] Add the backward-compatible nullable Google picture migration and document the next-sign-in requirement for existing sessions.
- [x] Document D1/Workers free-tier capacity and distinguish server account data from its offline cache.
- [x] Complete updated TypeScript, account/API unit tests, production build and desktop/mobile browser checks; record exact results below.
- [x] Deploy this account update with `0003_google_avatar.sql` and publish its assets/Worker to the production Custom Domain.
- [ ] Verify real Google avatar, automatic save/reload and another-device account loading after this update.

## Flight-entry and travel-day feedback

- [x] Use minute-resolution flight and airborne inputs while preserving unedited provider precision.
- [x] Seed a blank arrival from departure and preserve explicitly edited or previously saved arrivals.
- [x] Derive flight markers from itinerary intervals, independent of rest recommendations, in both engines.
- [x] Display flights and travel-day recommendations in both origin and destination zones with explicit local dates.
- [x] Keep flight-only days in Today and hide unavailable phase estimates.
- [x] Research and retain a sourced, provisional five-flight October 2026 regression fixture, including flight-number ambiguity.
- [x] Verify the real itinerary, editor behavior, date-line travel, and mobile layout in Chromium.
- [x] Complete final checks, update documentation, and sync the feedback changes to GitHub.

## Planner refinements and meals

- [x] Remove the repeated model disclosure from the daily plan; keep the scientific explanation on the Science page.
- [x] Repair modeled daily shift calculations and show missing history explicitly, with readable approximate change labels.
- [x] Consolidate timezone-specific source days into one calendar-date tile while preserving action clocks and both airport times.
- [x] Shape date tiles like airplane windows.
- [x] Add per-flight wake-for-meals advice and practical meal windows around sleep and cabin/connection constraints.
- [x] Export meal windows without sleep-interrupting alarms and explain the evidence on the Science page.
- [x] Verify five-flight regression, model estimates, meal policies, unique dates, and mobile layout; sync to GitHub.

## Lookup-first flight entry and provider activation

- [x] Make flight number and departure date the default flight-entry controls; keep manual airports, date-times and zones hidden until **Enter manually**, including for existing legs.
- [x] Retain a selected-flight summary and travel class/lie-flat choices; require renewed lookup confirmation or explicit manual entry after query edits.
- [x] Close trip drafts on account switches and reject saving a draft under a different account identity.
- [x] Document AeroDataBox Basic’s personal/noncommercial terms and 400 API units/month, distinguishing provider units from the app’s request budgets.
- [x] Provide the RapidAPI subscription/key walkthrough and GitHub `production` environment-secret setup, with a redeploy to upload the secret to the existing Worker.
- [x] Verify frontend/Worker TypeScript, the production build and desktop/mobile browser regressions; CI repeats the complete unit and browser suites before deployment.
- [x] Publish the lookup-first editor and verify its production mobile/manual fallback.
- [x] Confirm the owner has set `RAPIDAPI_KEY`, install its Worker secret and verify public production configuration enables lookup.
- [ ] Verify an authenticated booked-flight lookup and representative real future routes without claiming universal coverage.

## Mobile date controls and provider failure repair

- [x] Reproduce the flight exception in real workerd: unsupported `redirect: "error"` fails before outbound I/O.
- [x] Replace the provider redirect mode with `manual` and reject redirects without forwarding credentials.
- [x] Constrain Safari date/time intrinsic widths while preserving native pickers and minute precision; retain paired airborne clocks while editing either and invalidate them on gate-schedule changes.
- [x] Enable targeted, redacted provider failure diagnostics and document support references.
- [x] Complete TypeScript, all 332 unit/model/API/runtime tests, the build, Wrangler dry run and 30 browser scenarios (28 Chromium plus 2 mobile WebKit).
- [x] Publish the Safari/provider repair and confirm normal deployment completes without a public HTTP gate.
- [x] Receive the owner’s confirmation that mobile date sizing now looks good.
- [ ] Confirm successful signed-in booked-flight import after the allowance recovery below.

## Application allowance recovery

- [x] Inspect production allowance aggregates without account identifiers; confirm Rephase’s 10-request daily limit caused the block.
- [x] Make a secure real provider probe; confirm HTTP 200, one complete QF103 schedule and 396/400 provider units remaining.
- [x] Make daily/monthly/global budget reservation atomic, validate local request construction before spending and keep unknown network attempts conservative.
- [x] Add explicit app-versus-provider allowance messages, UTC reset and safe scope/reference diagnostics.
- [x] Prepare and locally apply a one-time incident-scoped account allowance recovery that preserves global counters and newer usage.
- [x] Detect and repair space-separated UTC timestamp handling using the real provider normalizer diagnostic, retaining all timezone/date checks.
- [x] Review current official provider alternatives; document why switching would not fix this app limit.
- [x] Validate a real response through the actual normalizer: HTTP 200, one valid QF103 candidate, no warnings and 390/400 provider units remaining; local TypeScript and all 357 tests passed.
- [x] Deploy the recovery and verify production account daily/monthly counters are 0 while the global monthly counter remains 10.

## Dynamic flight lookup — AeroDataBox

Amadeus Self-Service is discontinued. AirLabs's near-term schedules and Skyscanner's route-search API do not meet the known-flight/date requirement months ahead. Provider evidence, current plan limits, and terms are linked in DESIGN.md.

- [x] Implement an authenticated Worker adapter for flight number and departure-airport local date, with optional origin filtering.
- [x] Keep RapidAPI credentials server-side and bound provider workflow/response sizes without costly automatic retries.
- [x] Normalize airline, candidate legs, airports, scheduled local/UTC times, duration, and available runway times; preserve seconds.
- [x] Validate timezones, offsets, DST occurrences, and chronology; omit contradictory or incomplete data instead of inventing it.
- [x] Offer editable candidate confirmation with owner-specific booking acknowledgement, provenance, and retained cabin choices.
- [x] Cache normalized schedules/airport zones in D1 with timestamps, freshness/negative TTLs, explicit stale-on-error labels, and six-day retention.
- [x] Add hourly cache purging, isolate-level concurrent-request deduplication, and atomic per-account/global usage budgets.
- [x] Keep owner trip records separate from shared cache; preserve attribution through editing and explain cloud/device deletion.
- [x] Test synthetic provider fixtures, multi-candidate/no-result/errors, cache expiry, UTC/date-line/DST, deadlines, quotas, and secret isolation.

## Aircraft type in flight details

- [x] Verify AeroDataBox's official flight-number/date contract supplies an optional model in the existing response, without another request or key.
- [x] Normalize and validate only the bounded model label; retain usable schedules when equipment is missing and exclude tracking/photo data.
- [x] Display the model in lookup results, selected summaries, saved trips and planner flight cards, preserving explicit cabin/lie-flat choices.
- [x] Save optional aircraft metadata through browser/account state and plan generation; protect flight identity during multi-device merges and manual edits.
- [x] Version normalized cache entries so explicit relookups can refresh models discarded by the older adapter; keep existing retention and avoid bulk refreshes.
- [x] Add safe aircraft presence counts to the optional real-provider diagnostic.
- [x] Complete final mobile/save/reload browser checks, including missing equipment, unchanged bed choices and stale-model invalidation.
- [x] Publish the aircraft update after the full deployment checks.
- [x] Confirm aircraft presence on a real provider response and record the result without exposing schedule/tracking data in logs.

## Flight and sleep copy simplification

- [x] Remove the booked-trip checkbox; apply selected results directly with **Use this flight** while preserving source metadata.
- [x] Consolidate provider attribution into one linked site footer and remove repeated booking/import text from flight forms and trip cards.
- [x] Use **Final Destination**, **Transit** and **Adjustment Strategy** in the editor.
- [x] Use **Bedtime** and concise lie-flat/seated guidance in both engines; retain existing sleep timings and 30/60-minute airborne buffers.
- [x] Update existing planner/calendar and browser regressions for the simplified flow.
- [x] Complete final mobile/desktop browser verification, including all 16 targeted lookup/aircraft/travel/mobile-date scenarios.
- [x] Publish the copy update after full deployment checks.

## Clearer plan summaries and preferences

- [x] Rename the practical-light card to **Light tips** and replace repetitive model notes with daily change/remaining-adjustment values and one Science link.
- [x] Show unavailable daily history concisely without displaying an invented adjustment value.
- [x] Remove the melatonin preference warning/acknowledgement gate; use the existing toggle as the sole opt-in while preserving timing/dose restrictions.
- [x] Hide the technical planning-engine picker, keeping the default circadian model and existing saved-mode compatibility.
- [x] Add offline home-timezone autocomplete for cities/IANA names, keyboard/touch selection, UTC and valid aliases.
- [x] Verify timezone search, saved preference compatibility, melatonin opt-in and compact phase summaries in unit/desktop/mobile WebKit checks.
- [x] Publish the preferences/summary update and record deployment results.

## Daily visual timeline

- [x] Remove gate wording from departure/arrival cards; retain scheduled flight times and protected airborne sleep buffers, without fetching gate assignments.
- [x] Build chronological day geometry for overlapping flight/sleep/rest/light/darkness/caffeine/melatonin bands and inferred free time.
- [x] Render a continuous vertical day timeline with time/date/zone labels, inline flight/recommendation cards and mobile layout.
- [x] Preserve dual airport clocks, aircraft, meal advice/details, explanations and adherence recording.
- [x] Verify overlap, midnight/DST/date-line travel, five-flight itinerary, short flights and mobile readability.
- [ ] Publish the timeline through the single-check verified-artifact release path and record live checks.

## Arrival-city labels and faster releases

- [x] Resolve planner place labels from the itinerary airport city, independently of its IANA timezone, in both planning engines.
- [x] Cover existing saved trips, same-timezone city changes, unknown airports, San Francisco stay tiles, Today and timezone/estimate captions.
- [x] Run the full checks/browser suite once for a code commit and publish the tested frontend/Worker artifact with exact-commit provenance.
- [x] Make manual and enabled automatic deployments reuse only a successful trusted main-branch Checks artifact for that exact commit; reject missing, expired or mismatched artifacts.
- [x] Exclude documentation-only changes from automatic checks and document explicit recovery/reverification.
- [x] Verify the release path, deploy the city fix and record results without a public HTTP deployment gate.

Arrival-city/release-reuse verification (15 October 2026): 26 focused planner/place/calendar/travel tests, 73 focused release/deployment tests, frontend/Worker TypeScript, the production build and two affected desktop/mobile browser cases passed locally. An independent workflow review found no material issue. Real credential-free release creation, manifest verification and relocated Wrangler no-bundle dry run passed; the resulting Worker bundle was byte-for-byte identical. Source `6ddf92d804e55fd3d970470b4553e794e3e0a593` passed [Checks 38720429906](https://github.com/maniksurtani/rephase/actions/runs/38720429906) with all 422 tests across 32 suites and all 37 browser scenarios (34 Chromium, three mobile WebKit), then published immutable release artifact `11964831078`. The browser suite ran once in CI for this code commit and took 1.6 minutes.

Successful [deployment 38720826794](https://github.com/maniksurtani/rephase/actions/runs/38720826794) selected that Checks run and attempt, downloaded its exact artifact, verified the complete file inventory, applied no new migrations and uploaded the bundled Worker/static assets without rebuilding or rerunning tests. The deployment job took 29 seconds and installed the configured provider secret; uploaded Worker version was `e44fa3b4-9850-47da-8ccc-97eb59720db7` before the secret update. Public HTTP verification was not invoked. Separate anonymous live Chromium checks at 1440px/390px used the exact published `index-toAXgx4O.js`, verified San Francisco stays/tiles/Today and unchanged PDT clocks without overflow or page errors, and closed their browser. Only public configuration was requested; account endpoints were intercepted and a temporary guest namespace held the itinerary. No Google sign-in, account write or live provider request occurred. Automatic deployment remains disabled by the existing repository setting; manual deployment and future enabled main-check completion use the verified-artifact path.

## Launch, GitHub, and Cloudflare preparation

- [x] Provide `npm start` with dependency/build/local migration setup, port checks, readiness, and owned-process cleanup.
- [x] Provide browser-only and production-mode local launch options.
- [x] Add a GitHub remote helper that defaults to printing commands and never pushes or replaces another remote.
- [x] Add PR/main CI and a manual-first, optionally automatic Cloudflare GitHub Actions workflow.
- [x] Add public configuration validation, ignored generated Wrangler config, dry-run/apply scripts, and secret setup guidance.
- [x] Verify real Wrangler dry-run bundling without external publication.
- [x] Run final TypeScript, 173 unit/model/API tests, production build, local migration/API, scheduled purge, and all ten browser scenarios.
- [x] Commit the completed local implementation and prepare the preview/GitHub/Cloudflare handoff.

## External setup and research gates

- [x] Receive the SSH remote `git@github.com:maniksurtani/rephase.git`, confirm it is empty, and configure `origin`.
- [x] Prepare a verified Git bundle containing the complete history for a local SSH push.
- [x] Complete the initial push to [maniksurtani/rephase](https://github.com/maniksurtani/rephase), with local `main` tracking `origin/main`.
- [x] Select `https://rephase.surtani.org` and prepare generated Custom Domain routing with Cloudflare-managed DNS/TLS and no alternate deployment URLs.
- [x] Configure the production Google client ID and verify real sign-in with the owner’s account.
- [ ] Verify the revised automatic account-saving experience end to end with the owner’s account after its release.
- [x] Receive the AeroDataBox RapidAPI key through GitHub, deploy it as a Worker secret and confirm lookup is enabled.
- [ ] Verify provider access with a booked flight and representative routes at +60/+90/+150 days; record missing coverage.
- [x] Configure the Cloudflare account, D1 and production GitHub variables/secret; support manual dispatch and optional main-push deployment through the repository variable `DEPLOY_ENABLED=true`.
- [x] Deploy to https://rephase.surtani.org with D1 migrations, Custom Domain DNS/TLS and hourly purge.
- [x] Verify production guest planning/calendar, mobile layout, Science/no-JavaScript, all offline assets, offline behavior and unauthenticated API rejection.
- [x] Allow first-time DNS/TLS provisioning in the bounded post-deploy verification retry window.
- [x] Isolate public verification in a read-only manual workflow and diagnose GitHub-runner HTTP 403 Cloudflare challenges without exposing response bodies or credentials.
- [x] Stop confirmed browser challenges immediately with safe diagnostics and document service-specific, narrowly scoped exceptions.
- [x] Remove the final public HTTP check from normal deployment at the owner’s request; retain optional read-only diagnostics without changing Cloudflare protections.
- [ ] Arrange qualified review of melatonin timing/dose suitability and evaluate usability/real-world outcomes before claiming clinical efficacy.

## Optional future decisions

- [x] Provide an optional Bun benchmark/compatibility script and check availability. Bun is absent here; no installation, benchmark result, or lockfile migration is claimed.
- [ ] Run Bun comparisons if adopting that toolchain is desired.
- [ ] Consider Web Push only after a product decision and mobile delivery testing; calendar reminders are implemented.
- [ ] Consider measured phase/light inputs, richer sleep/fatigue models, and cross-tab live editing as separate enhancements.

Previous planner feedback verification (2026-10-15): frontend and Worker TypeScript passed; all 238 Vitest tests passed across 21 suites using one worker. The production build contains 24 precached assets. All 15 Chromium scenarios passed, including one calendar tile per date, oval window styling, varied modeled changes and explicit unavailable history, per-leg meal policies and both meal clocks, the five-flight itinerary/date-line transit, minute-only arrival defaulting, saved-arrival preservation, mobile overflow, and existing offline/account/flight/adherence behavior. Unit coverage includes missed/actual sleep history, connection/airborne meal constraints, deduplicated alarm-free meal calendar events, and all source clocks contributing to Today. Initial implementation checks also verified local D1 migrations/API responses, scheduled cache purging, launcher startup/shutdown, and real Wrangler dry-run bundling; no Worker behavior changed in this refinement.

Real OAuth/provider coverage and clinical efficacy are not implied by these checks. The code is synced to [maniksurtani/rephase](https://github.com/maniksurtani/rephase), and local `main` tracks `origin/main`. Production is live at https://rephase.surtani.org; the owner has verified real Google sign-in, the revised automatic account-saving flow awaits release acceptance, and provider lookup is enabled after installing its key; authenticated live provider acceptance remains pending.

Account update verification (2026-10-15): frontend and Worker TypeScript passed, all 319 Vitest tests passed across 25 suites, the production build prepared 24 offline assets, and all 23 Chromium scenarios passed locally and in GitHub Actions. Coverage includes automatic server saving/reload/new-device loading, direct Google button flow, avatar/Sign out menu, expired sessions, offline retries, persistent conflicts, unsaved form preservation and account switches, and three-tab draft recovery. Local and production `0003_google_avatar.sql` migrations and Wrangler dry-run bundling passed. The updated Worker/assets are deployed by [run 38686653951](https://github.com/maniksurtani/rephase/actions/runs/38686653951); its final runner public check is blocked by the known Cloudflare challenge. Google SDK/account APIs are mocked in browser regressions; real-account acceptance remains pending.

Anonymous production checks with the real Google SDK passed at 1120px and 390px: official sign-in iframes load, there is no application login dialog or horizontal overflow, and guest planning/meals/unique dates/offline Science work. The Google iframe transparency fix was verified before and after SDK mounting without altering Google's button design. No Google login was completed and no flight-provider credits were used during these checks.

Lookup-first editor verification (2026-10-15): frontend and Worker TypeScript passed and the production build prepared 24 offline assets. All 27 existing Chromium scenarios passed after updating manual-entry regressions; three targeted scenarios passed again on the final build, including the new account-switch draft-isolation case (28 total scenarios). Coverage includes default-hidden manual fields, mobile entry and arrival defaults, unavailable lookup, provider selection/cabin preservation, changed-query save guards, independent multi-leg controls and retained attribution after manual edits. Google and provider responses are mocked; these checks do not establish live flight coverage. GitHub deployment [38689043879](https://github.com/maniksurtani/rephase/actions/runs/38689043879) passed all 319 unit tests across 25 suites and all 28 browser scenarios before publishing Worker version `78641296-6f6e-4391-9558-8a0df403249b` and the new assets. Its final runner check remains blocked by the known Cloudflare challenge (Ray `a4ac90994ed78a1f-ORD`, 05:53 UTC). Anonymous production browser checks passed at 1280px and 390px with the exact new assets: lookup-first/default-hidden manual fields, date-preserving manual fallback and no horizontal overflow. At that initial release, public configuration confirmed Google/account storage enabled and flight lookup disabled; no Google sign-in or provider calls were performed. The key was subsequently installed as recorded below; authenticated real-flight acceptance remains pending.

Provider activation verification (2026-10-15): the owner confirmed `RAPIDAPI_KEY` saved in GitHub. Deployment [38691252414](https://github.com/maniksurtani/rephase/actions/runs/38691252414), at commit `e8e7be2`, passed TypeScript, all 319 unit tests across 25 suites, the build and all 28 browser scenarios; the Worker upload and secret installation succeeded. The final runner check hit the existing Cloudflare challenge (Ray `a4acb2522d8b442f-ORD`, 17:16 AEDT). Subsequent public browser checks received HTTP 200 with Google/account storage/flight lookup all configured and verified healthy mobile lookup/manual entry without overflow. No Google sign-in or live provider requests were made: the flag establishes configured key presence, not provider credential validity, subscription allowance or future-flight coverage.

Safari/provider repair verification (2026-10-15): frontend/Worker TypeScript, all 332 Vitest tests across 26 suites, the production build (24 offline assets) and real Wrangler dry-run bundling passed. All 28 Chromium scenarios and both dedicated mobile WebKit scenarios passed. The WebKit cases verify empty/filled date inputs and manual departure/arrival/takeoff/landing controls at 375px and 390px, minute values, paired airborne-clock retention and gate-change invalidation. Real workerd adapter tests use local D1 and intercepted outbound requests to verify the supported fetch mode and reject redirects without forwarding credentials. Safe diagnostics have redaction/category/reference regressions. Linux mobile WebKit did not reproduce the physical iPhone overflow with the CSS fix removed; these checks establish control bounds and value preservation, with physical Safari acceptance remaining useful. No live provider calls or real Google sign-in were performed. Deployment [38693556714](https://github.com/maniksurtani/rephase/actions/runs/38693556714), commit `8e5d13e`, passed all 332 tests and all 30 browser scenarios again in GitHub and completed successfully, including the Worker upload and provider secret installation. It published Worker version `801848c3-b5be-4a74-a036-514915d53943` before updating the secret. The public HTTP verification was not invoked; no zone security settings were changed. A subsequent anonymous production WebKit check at 390px confirmed the exact new JS/CSS/offline version, HTTP 200 public configuration with Google/account storage/lookup enabled, and bounded lookup/manual date-time controls without overflow or page errors. No Google login or provider request was made.

Allowance recovery verification (2026-10-15): frontend/Worker TypeScript and all 357 Vitest tests across 28 suites passed locally. Real workerd/D1 tests cover all-or-none concurrent reservation; regression tests cover local preflight failures, app/provider distinction, exact reset/reference diagnostics, retained global/newer counters during incident recovery and explicit UTC timestamp variants. The recovery migration applied successfully to local D1. Secure production diagnostics confirmed the 10/10 app daily counter, available provider units and a real QF103 response; the follow-up real-normalizer check detected the UTC separator issue fixed in this release. Real-normalizer recheck [38697406152](https://github.com/maniksurtani/rephase/actions/runs/38697406152) passed with HTTP 200, one candidate, no warnings and 390/400 units remaining. Successful deployment [38697515002](https://github.com/maniksurtani/rephase/actions/runs/38697515002) passed all 357 tests and 30 browser scenarios, applied the recovery migration, uploaded Worker version `31049702-a1a6-4dbf-be98-f5a16b7d9979` and installed the key. Read-only postcheck [38698020023](https://github.com/maniksurtani/rephase/actions/runs/38698020023) confirms account daily/monthly counters are both 0 and the global monthly counter is still 10. No extra provider request was made by that postcheck. The signed-in app import remains the owner’s final acceptance step.

Aircraft update verification (2026-10-15): frontend/Worker TypeScript, all 375 Vitest tests across 28 suites, the production build and all 33 browser scenarios (31 Chromium and two mobile WebKit) passed in successful [deployment 38699877427](https://github.com/maniksurtani/rephase/actions/runs/38699877427), source `3c813350`. It uploaded Worker version `80d7ae4a-13a7-4c00-89d0-36c1fad8467c`, installed the provider secret and published 24 offline assets (version `17128b9cc6c01c03`). No database migration or configuration change was required. All 11 targeted aircraft/lookup/mobile scenarios also passed locally on the final build. Coverage includes model display in candidate/selected/saved/planner views, server autosave and reload, missing-model replacement, manual identity changes, unchanged cabin choices and 390px layout. These browser checks use controlled API responses.

Separate secure diagnostic [38699851931](https://github.com/maniksurtani/rephase/actions/runs/38699851931) confirmed HTTP 200, one real QF103 record with a model, one normalized candidate retaining its model and no warnings. It made exactly one provider request, leaving 388/400 units, with only safe presence counts logged. Account daily/monthly reservations remained 0 and the global monthly counter remained 10. Real-account import and wider dated-flight/equipment coverage remain acceptance checks.

Anonymous production smoke passed at 390px after the aircraft release: exact new JS/CSS/offline assets returned HTTP 200, public Google/account/lookup configuration was healthy, lookup-first/manual entry preserved dates and stayed within the viewport, and no page errors occurred. This check made no provider request or Google sign-in. Its browser was closed afterward; no preview server was started.

Flight/sleep copy update verification (2026-10-15): 54 targeted planner/model/meal tests, frontend/Worker TypeScript and the production build passed locally. All 16 affected browser scenarios passed after correcting a renamed-field test selector, including direct flight selection, unchanged aircraft/cabin persistence, Final Destination/Transit controls, Bedtime/Rest or nap headings, the five-flight itinerary and both mobile WebKit date checks. Screenshots verify the cleaner editor and a single footer attribution link at 390px. Successful [deployment 38704795693](https://github.com/maniksurtani/rephase/actions/runs/38704795693), source `dc7db34a`, passed all 375 unit tests and 33 browser scenarios, uploaded Worker version `d57a263c-fe0d-4ec5-a189-80771037f42a`, installed the configured secret and published 24 offline assets (version `ab1c864750ad6c3b`). The full CI browser suite took 1.8 minutes. No provider requests or Google sign-ins were made by these checks; no configuration or database changes were required.

The copy release also passed a bounded anonymous production check at 390px: exact new assets/configuration, Bedtime guidance, one visible footer attribution link, concise destination/transit/strategy labels and no removed import/booking/crew reminders in the editor. No page errors, horizontal overflow, auth calls or provider requests occurred; the browser was closed afterward. Standard hosted GitHub Actions runners are free for this public repository; duplicate suite runs still add waiting time. Release-note-only commits skip CI, while the implementation release retained its full checks.

Preferences/summary verification (2026-10-15): frontend/Worker TypeScript, 37 focused planner/model checks, all 12 timezone-search tests and the production build passed locally. Eleven targeted browser scenarios passed across the affected preferences, phase/travel, native date and mobile WebKit flows. A search regression prevents combining words from unrelated cities in one timezone. A real mobile WebKit tap regression verified canonical selection after a pointer-release fix; the final four preference/timezone cases passed together on the final build. Coverage includes desktop mouse/keyboard selection, touch selection, Escape/blur, invalid input, account save/reload, retained aliases/rules mode, melatonin enabled without the legacy acknowledgement, eligible guidance and concise phase metrics without invented unknown values. Native scrolling gestures were not simulated or claimed verified.

Successful [deployment 38710586934](https://github.com/maniksurtani/rephase/actions/runs/38710586934), source `61bd2252`, passed all 387 unit tests across 29 suites and all 37 browser scenarios (34 Chromium and three mobile WebKit), then uploaded Worker version `82673a51-9555-4f0a-a755-271c55d95555`, installed the configured secret and published 24 offline assets (version `e3e88588d5ce5cae`). The full browser suite took 2.1 minutes. No configuration or database migration was needed; the obsolete acknowledgement field remains compatible with saved data and the existing model assumptions/timing restrictions remain intact. Automated checks used controlled account/provider responses without real Google sign-in or provider requests.

A bounded anonymous production mobile WebKit check at 390px passed against the exact new assets. A real touch selects Sydney's canonical zone and closes suggestions; simplified melatonin controls, the absent planner picker, the compact unavailable-history card and Light tips all render correctly. No page errors, provider/auth calls, account writes or preference saves occurred, and the browser was closed afterward. This check does not claim physical-iPhone or native scrolling-gesture acceptance.
