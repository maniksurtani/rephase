# Rephase build tasks

This checklist is updated during implementation. `[x]` means implemented and checked as described; unfinished research and external setup remain explicit. Local-only work is authorized; Cloudflare deployment is deferred.

## Foundation — root

- [x] Create a new git repository at `/workspace/rephase`.
- [x] Write the system design, requirements, scientific limitations, and API contracts in DESIGN.md.
- [x] Establish TypeScript domain contracts and Vite/React project structure.
- [x] Install and lock dependencies.
- [x] Document local setup, Google configuration, and preview commands in README.md.

## Planning and time — science/engine agent

- [x] Resolve IANA timezone inputs using Temporal; reject DST ambiguity and missing times.
- [x] Validate all flight legs in UTC, including connections and date-line crossings.
- [x] Implement a versioned conservative planning engine with whole-trip phase continuity.
- [x] Respect preparation availability, sleep duration/anchor, connection buffers, and per-stay strategies.
- [x] Generate explainable light, sleep, and optional caffeine guidance with conflict checks.
- [x] Add opt-in melatonin information with eligibility checks and explicit uncertainty limits.
- [x] Test DST, fractional offsets, multi-stop continuity, invalid itineraries, and supplement opt-outs.

## Mobile app — UX agent

- [x] Build responsive dark Rephase navigation and Today/Plan views.
- [x] Implement a clearly labeled multi-stop example and future/current trip states.
- [x] Build create/edit/delete itinerary flows with airports, local dates/times, zones, and connections/stays.
- [x] Build editable sleep/chronotype/supplement preferences and preference-conflict explanations.
- [x] Add science explanations, sources, loading/error states, and accessible controls.
- [x] Add per-flight travel class and explicitly confirmed lie-flat availability, with conservative legacy defaults.
- [x] Test first-30-minute and last-60-minute flight rest exclusions across seat types.

## Local data and offline — root

- [x] Bundle a common-airport/timezone catalog with custom-zone fallback.
- [x] Persist preferences and trips in IndexedDB with schema validation and account separation.
- [x] Add account-local data clearing and JSON export.
- [x] Export timezone-safe `.ics` action events and optional calendar alarms.
- [x] Add an installable manifest, icons, and production static-asset service worker.
- [x] Integrate Google GIS configuration and real sign-in code; show unavailable state without credentials (end-to-end OAuth verification remains below).
- [x] Integrate explicit cloud sync and revision-conflict resolution without silent overwrites.

## Minimal backend — architecture agent

- [x] Prepare local Worker static assets/SPA configuration and D1 migration.
- [x] Verify Google tokens and one-time login challenges; use secure revocable sessions.
- [x] Implement account-owned state read/write/delete with validation and revision conflicts.
- [x] Enforce same-origin mutations, payload bounds, and session isolation.
- [x] Add meaningful Worker security/validation tests and dev environment example.

## Integration and handoff — root

- [x] Run TypeScript checks, engine/API/export tests, and production build; fix observed failures.
- [x] Smoke-check the local app and Worker/API against local D1.
- [x] Run supported browser QA and record credential-dependent verification limits.
- [x] Update documentation/checklist to match the actual implementation.
- [x] Commit the completed local implementation in the new repository.
- [x] Provide local preview instructions in README.md and the handoff; disclose credential-dependent features.

Verified locally: frontend/Worker TypeScript, all 46 Vitest tests, production build with 17 precached assets, and six Chromium browser scenarios (desktop agenda/calendar export; mobile preference persistence/overflow; personal-trip editing/focus/cabin persistence; invalid arrival rejection; offline account namespace; revision-conflict choices). A browser-test locator was corrected and its affected scenario passed the focused rerun. D1 migration 0001 and local Worker configuration/401/403 smoke checks succeeded. Real Google sign-in awaits an OAuth client; live provider lookup, numerical-model validation, and Cloudflare deployment remain below.

## Next milestones — not included in the first local implementation

- [ ] Configure a real Google OAuth web client and test Google sign-in end to end.
- [ ] Compare a published oscillator TypeScript port with the numerical reference, including attribution.
- [ ] Implement constrained advance/delay optimization rather than heuristic shift assumptions.
- [ ] Add destination daylight feasibility and actual light/sleep adherence logging/replanning.
- [ ] Validate melatonin timing/dose integration independently with qualified clinical review.
- [ ] Evaluate plan usability and real-world outcomes; do not imply efficacy validation beforehand.
- [ ] Expand airport coverage and resolve repeated DST times through explicit offset selection.
- [ ] Add robust per-trip concurrent sync/merge and automated sync if needed.
- [ ] Benchmark Bun for package installation/script execution and verify Wrangler, native dependencies, and test compatibility before any toolchain migration.
- [ ] Add optional calendar-reminder preferences or Web Push delivery after platform testing.
- [ ] Discuss Cloudflare account/domain, D1 resources, environment configuration, and deployment with the user.
- [ ] Deploy and verify on Cloudflare only after that discussion.

## Dynamic flight lookup — requested roadmap, recommended candidate AeroDataBox

Amadeus's historical Self-Service portal/free tier is no longer assumed available: the official portal reports decommissioning on July17, and its official API specification repositories were archived July17,2026. See DESIGN.md for sources and the historical endpoint mapping. No live provider integration has been implemented.

- [x] Compare AirLabs, Skyscanner, and alternatives against known-flight/date lookup months ahead; document verified limits in DESIGN.md.
- [ ] Evaluate AeroDataBox RapidAPI Basic (noncommercial prototype) or Pro (commercial) with a user-provided API key; confirm current access, quotas, attribution, and caching terms.
- [ ] Verify representative routes at +60/+90/+150 days; record absent/partial coverage and keep manual fallback.
- [ ] Define a provider adapter for flight number/carrier plus departure-airport local date (and operational suffix/origin where needed).
- [ ] Protect provider credentials inside the Worker; implement token refresh only when the selected provider requires it.
- [ ] Fetch and normalize departure/arrival airports, scheduled local times and offsets, duration, carrier and operating/codeshare information.
- [ ] Handle multi-leg flight numbers and multiple candidates without assuming a nonstop itinerary.
- [ ] Distinguish scheduled gate times from takeoff/landing timestamps; re-anchor the 30/60-minute operational buffers when actual airborne data is available.
- [ ] Join airport codes to IANA timezones, resolve UTC instants, and validate time/duration consistency.
- [ ] Build an editable flight-result confirmation flow that preserves manual entry, cabin class, and actual lie-flat availability.
- [ ] Add D1 cache with provider/environment/version/flight/date keys, source, fetchedAt, expiresAt, and provider-approved expiry policies.
- [ ] Keep shared cache retention separate from owner-specific booked-trip retention and delete incorporated provider data when the owner deletes the trip.
- [ ] Deduplicate concurrent lookups, cap usage/pagination, and briefly cache genuine no-results.
- [ ] Show stale cached data explicitly during refresh failures; handle cancellation, no-match, API outages, and provider limits.
- [ ] Test airport-local date interpretation, codeshares, overnight/date-line flights, cache freshness, secret isolation, and quota behavior.
