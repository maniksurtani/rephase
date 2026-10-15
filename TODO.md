# Rephase build tasks

Updated 2026-10-15. Checked items are implemented and engineering-verified. External credentials, publication, and clinical/outcome research are separate gates; they cannot be completed by local tests.

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
- [x] Add opt-in automatic sync, bounded retries, offline behavior, deletion pauses, and account reauthentication controls.

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
- [x] Configure the production Google client ID and expose the sign-in/sync controls.
- [ ] Verify real Google sign-in and trip sync end to end with the owner's account.
- [ ] Choose an AeroDataBox plan, configure its key, and verify representative routes at +60/+90/+150 days; record missing coverage.
- [x] Configure the Cloudflare account, D1 and production GitHub variables/secret; keep deployments manual.
- [x] Deploy to https://rephase.surtani.org with D1 migrations, Custom Domain DNS/TLS and hourly purge.
- [x] Verify production guest planning/calendar, mobile layout, Science/no-JavaScript, all offline assets, offline behavior and unauthenticated API rejection.
- [x] Allow first-time DNS/TLS provisioning in the bounded post-deploy verification retry window.
- [ ] Arrange qualified review of melatonin timing/dose suitability and evaluate usability/real-world outcomes before claiming clinical efficacy.

## Optional future decisions

- [x] Provide an optional Bun benchmark/compatibility script and check availability. Bun is absent here; no installation, benchmark result, or lockfile migration is claimed.
- [ ] Run Bun comparisons if adopting that toolchain is desired.
- [ ] Consider Web Push only after a product decision and mobile delivery testing; calendar reminders are implemented.
- [ ] Consider measured phase/light inputs, richer sleep/fatigue models, and cross-tab live editing as separate enhancements.

Latest feedback verification (2026-10-15): frontend and Worker TypeScript passed; all 238 Vitest tests passed across 21 suites using one worker. The production build contains 24 precached assets. All 15 Chromium scenarios passed, including one calendar tile per date, oval window styling, varied modeled changes and explicit unavailable history, per-leg meal policies and both meal clocks, the five-flight itinerary/date-line transit, minute-only arrival defaulting, saved-arrival preservation, mobile overflow, and existing offline/account/flight/adherence behavior. Unit coverage includes missed/actual sleep history, connection/airborne meal constraints, deduplicated alarm-free meal calendar events, and all source clocks contributing to Today. Initial implementation checks also verified local D1 migrations/API responses, scheduled cache purging, launcher startup/shutdown, and real Wrangler dry-run bundling; no Worker behavior changed in this refinement.

Real OAuth/provider coverage and clinical efficacy are not implied by these checks. The code is synced to [maniksurtani/rephase](https://github.com/maniksurtani/rephase), and local `main` tracks `origin/main`. Production is live at https://rephase.surtani.org; Google account sync awaits user verification and provider lookup remains disabled without its key.
