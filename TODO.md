# Rephase build tasks

Updated 2026-10-18. Active work is kept here; the previous complete checklist is preserved in [the task archive](docs/archive/TODO-2026-10-16.md). Release evidence is in [the verification archive](docs/archive/VERIFICATION-2026-10-16.md).

## Collapsible melatonin guidance

- [x] Put melatonin usage text, dose information, explanation and source behind a default-closed Melatonin guidance disclosure in Plan and Today cards.
- [x] Check mobile tap/keyboard expansion and publish the verified release; all 46 browser scenarios passed, with live Plan/Today checks at mobile and desktop widths. See RELEASES.md.

## Current-time agenda and preflight lounge links

- [x] Show current/upcoming Today cards using the device clock, retaining ongoing recommendations and hiding completed ones.
- [x] Refresh the clock when the app resumes and keep future/finished trips and date-line days accurate.
- [x] Put Lounge Explorer on a real preflight timeline point before departure, including connections and midnight departures.
- [x] Check late Honolulu sleep timing against the itinerary and add a coarse gradual-adjustment regression; no numerical defect established, so keep the model unchanged.
- [x] Verify focused time/travel regressions and publish the exact checked release: 538 unit/runtime tests and 46 browser cases passed in CI; live desktop/mobile guest checks passed. See RELEASES.md.

## Code-review refactor and release

- [x] Protect open trip drafts against background changes/deletion and correct history dates in the recorded timezone.
- [x] Resolve current cross-tab drafts on account deletion while retaining edits created during the request.
- [x] Replace wording-based planning decisions with structured direction, sleep-kind and observation fields.
- [x] Share dialog focus, topmost dismissal and scroll-lock behavior; separate Google SDK and API transport.
- [x] Extract screen components and lightweight itinerary helpers; remove planner import cycles and duplicated airport catalog from its Worker.
- [x] Remove superseded storage/timeline APIs, one-off setup tools and the retired production HTTP checker.
- [x] Consolidate browser journeys/fixtures, make design captures opt-in, and retain scientific/security/runtime regressions.
- [x] Discover lounge datasets automatically for both app and validation.
- [x] Archive completed task/release history and retain current architecture and active work.
- [x] Verify formatting/hooks lint, TypeScript, 525 unit/runtime tests, bundle size and all 43 browser checks; final CSS rerun 9/9.
- [x] Commit/push the refactor and deploy its exact verified release artifact; [release evidence](RELEASES.md).

## Flight updates — designed, not yet implemented

- [x] Review AirLabs official endpoint/date/horizon/free-field constraints and design a shared queue/cache with a reusable HTTP contract in DESIGN.md.
- [ ] Run a small free-key capability trial: account entitlement/reset, >48h/24h/10h coverage, estimates/actual/status/equipment, repeated flights/codeshares/date lines and quota cost of failed/empty requests; confirm caching/retention rights.
- [ ] Choose/enable a provider only after reliable exact-occurrence updates are established; retain AeroDataBox/manual future lookup.
- [ ] Add per-trip opt-in and shared tracked flights/private subscriptions; preserve occurrence identity across reviewed updates and tracking changes.
- [ ] Implement a disabled-by-default adapter, five-minute due-job claims, bounded polling, atomic billing budgets, backoff and sanitized diagnostics.
- [ ] Add cached update reads, safe Update plan review and equipment-related seat confirmation; preserve offline planning.
- [ ] Verify matching, deduplication, concurrency/quota recovery, isolation/deletion and mobile review; pilot a small budget before expanding.
- [ ] Later: verified codeshare aliases, opt-in push delivery and Flutter client/native authentication.

## Owner acceptance and research

- [ ] Confirm the exact Honolulu 01:42 bedtime against the traveler’s actual saved preferences, trip details and recorded sleep when supplied.

- [ ] Verify revised automatic account saving, account switching, offline edits/reconnection and deletion with real Google accounts/devices.
- [ ] Confirm signed-in booked-flight import and representative future +60/+90/+150-day coverage with the configured provider.
- [ ] Verify lounge memberships and boarding-pass eligibility against real bookings; extend airport research and licensed photos.
- [ ] Confirm physical-device Safari/date/timezone interactions and native scrolling behavior.
- [ ] Obtain independent scientific/clinical review before making claims about personal outcomes; numerical verification is not clinical validation.

## Deliberate future decisions

- [ ] Decide whether to migrate old rules-mode preferences and retire that planner; preserve existing behavior until then.
- [ ] Broader notification, accessibility/localization and native-client work should follow actual usage and the flight-provider trial.
