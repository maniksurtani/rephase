# Rephase build tasks

This checklist is updated during implementation. `[x]` means implemented and checked as described; unfinished research and external setup remain explicit. Local-only work is authorized; Cloudflare deployment is deferred.

## Foundation — root

- [x] Create a new git repository at `/workspace/rephase`.
- [x] Write the system design, requirements, scientific limitations, and API contracts in DESIGN.md.
- [x] Establish TypeScript domain contracts and Vite/React project structure.
- [ ] Install and lock dependencies.
- [ ] Document local setup, Google configuration, and preview commands in README.md.

## Planning and time — science/engine agent

- [ ] Resolve IANA timezone inputs using Temporal; reject DST ambiguity and missing times.
- [ ] Validate all flight legs in UTC, including connections and date-line crossings.
- [ ] Implement a versioned conservative planning engine with whole-trip phase continuity.
- [ ] Respect preparation availability, sleep duration/anchor, connection buffers, and per-stay strategies.
- [ ] Generate explainable light, sleep, and optional caffeine guidance with conflict checks.
- [ ] Add opt-in melatonin information with eligibility checks and explicit uncertainty limits.
- [ ] Test DST, fractional offsets, multi-stop continuity, invalid itineraries, and supplement opt-outs.

## Mobile app — UX agent

- [ ] Build responsive dark Rephase navigation and Today/Plan views.
- [ ] Implement a clearly labeled multi-stop example and future/current trip states.
- [ ] Build create/edit/delete itinerary flows with airports, local dates/times, zones, and connections/stays.
- [ ] Build editable sleep/chronotype/supplement preferences and preference-conflict explanations.
- [ ] Add science explanations, sources, loading/error states, and accessible controls.

## Local data and offline — root

- [ ] Bundle a common-airport/timezone catalog with custom-zone fallback.
- [ ] Persist preferences and trips in IndexedDB with schema validation and account separation.
- [ ] Add account-local data clearing and JSON export.
- [ ] Export timezone-safe `.ics` action events and optional calendar alarms.
- [ ] Add an installable manifest, icons, and production static-asset service worker.
- [ ] Integrate Google GIS configuration and real sign-in; show unavailable state without credentials.
- [ ] Integrate explicit cloud sync and revision-conflict resolution without silent overwrites.

## Minimal backend — architecture agent

- [ ] Prepare local Worker static assets/SPA configuration and D1 migration.
- [ ] Verify Google tokens and one-time login challenges; use secure revocable sessions.
- [ ] Implement account-owned state read/write/delete with validation and revision conflicts.
- [ ] Enforce same-origin mutations, payload bounds, and session isolation.
- [ ] Add meaningful Worker security/validation tests and dev environment example.

## Integration and handoff — root

- [ ] Run TypeScript checks, engine/API/export tests, and production build; fix observed failures.
- [ ] Smoke-check the local app and Worker/API against local D1.
- [ ] Run supported browser QA when available; record any verification limit.
- [ ] Update documentation/checklist to match the actual implementation.
- [ ] Commit the completed local implementation in the new repository.
- [ ] Give the user local preview instructions and disclose credential-dependent features.

## Next milestones — not included in the first local implementation

- [ ] Configure a real Google OAuth web client and test Google sign-in end to end.
- [ ] Compare a published oscillator TypeScript port with the numerical reference, including attribution.
- [ ] Implement constrained advance/delay optimization rather than heuristic shift assumptions.
- [ ] Add destination daylight feasibility and actual light/sleep adherence logging/replanning.
- [ ] Validate melatonin timing/dose integration independently with qualified clinical review.
- [ ] Evaluate plan usability and real-world outcomes; do not imply efficacy validation beforehand.
- [ ] Expand airport coverage and resolve repeated DST times through explicit offset selection.
- [ ] Add robust per-trip concurrent sync/merge and automated sync if needed.
- [ ] Choose/license a flight-number lookup provider, then add a secret-key Worker proxy and manual fallback.
- [ ] Add optional calendar-reminder preferences or Web Push delivery after platform testing.
- [ ] Discuss Cloudflare account/domain, D1 resources, environment configuration, and deployment with the user.
- [ ] Deploy and verify on Cloudflare only after that discussion.
