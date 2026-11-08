# Rephase build tasks

Updated 2026-11-08. Active work is kept here; the previous complete checklist is preserved in [the task archive](docs/archive/TODO-2026-10-16.md). Release evidence is in [the verification archive](docs/archive/VERIFICATION-2026-10-16.md).

## Continuous Bands timeline

- [x] Mock up three interactive mobile concepts with continuous scrolling, local midnight dividers, explicit in-flight clock changes, persistent flight/rest spans, compressed quiet time and expandable details. See [the comparison and previews](docs/prototypes/continuous-timeline/README.md).
- [x] Check the Sydney–Los Angeles and SFO–LAX–Melbourne examples, narrow-screen overflow, clock/date continuity and prototype interactions.
- [x] Select Bands for further design iteration; compare three structural timezone-change cues, place flight details in a separate right-hand track, and replace column headings with direct band labels and an optional key.
- [x] Choose Clock fold (option 3) from the refined Bands comparison.
- [x] Build a shared continuous journey presentation from real planner intervals, with local midnights, in-flight clock folds, continuous sleep/flight bands and date navigation.
- [x] Implement the Bands presentation on web and Flutter, retaining guidance, recording and meals in expandable details, with direct lounge links before departures.
- [x] Verify date-line/DST journeys, current-time navigation, narrow screens, larger native text and noninteractive clock folds; publish the web release and mobile source updates. Checks 42499134347, Mobile checks 42499134252, both native runtimes in 42498153297 and Cloudflare deployment 42499591549 pass. See RELEASES.md.

## Practical sleep opportunities

- [x] Reproduce late trip entry counting unavailable preparation and rigidly advancing wake time; identify that circadian error scoring has no practical sleep constraints.
- [x] Bound preparation by trip creation/reported history, protect usual preflight wake time, and compare routine sleep with limited extra-rest windows.
- [x] Keep destination sleep at the selected local anchor while carrying the body-clock state forward for light guidance; retain airborne/airport buffers and home-time strategies.
- [x] Verify QF11 late entry, earlier/later routines, early departures, DST, the Pacific itinerary and unchanged supplement/observation boundaries; ten relevant browser scenarios and shared mobile-engine parity pass locally.
- [x] Publish the shared web/native engine fix: Checks 42353883770, Mobile checks 42353883748, both native runtimes in 42353883810, and verified-artifact Cloudflare deployment 42354196880 pass.

## Native trip reminders

- [x] Add opt-in local reminders for all saved trips using the existing offline planner, absolute times and the nearest 60 future guidance windows.
- [x] Merge continuous sleep/light windows; omit past, recorded and disabled optional guidance; refresh on edits, deletion, account changes and app resume.
- [x] Add Profile permission controls, per-account/device preferences, test delivery and account-safe notification deep links.
- [x] Configure Android notification/boot receivers and desugaring, and the iOS notification delegate without adding a push backend.
- [x] Verify queue limits, date-line/DST timing, cancellation races, permission failures, retry and cold/warm taps; all 45 Flutter tests pass locally.
- [x] Push and verify both native runtimes in run 41646001351, including real-plan reminder extraction and notification/storage plugin initialization; the final test refinement also passes all 45 tests in fast run 41648049789.
- [ ] Check permission prompts, closed/offline delivery, tap navigation and Android reboot restoration on physical devices using mobile/README.md.

## Faster CI feedback

- [x] Measure the previous fix's workflow steps: 26m01s elapsed after an iOS startup failure, with 19-second Flutter tests and an 11m04s cold iOS build. Keep the inexpensive regression tests.
- [x] Separate fast Flutter checks from full native compilation/runtime checks, with targeted native inputs, nightly verification and manual release checks.
- [x] Skip web checks for mobile-only changes and skip mobile checks for Markdown-only changes; preserve exact-commit web release provenance.
- [x] Cache the pinned Flutter SDK and engine artifacts, Gradle and iOS dependency downloads; retain revision checks and native diagnostics.
- [x] Make installable APK artifacts explicit manual/release outputs and document the workflows.
- [x] Validate workflow syntax and 28 trigger scenarios, push, and verify the new jobs. Fast checks passed in 76s cold / 74s with cache hits; both native runtimes and web Checks passed. Record native cache seeding without assuming warm-build savings.
- [ ] Investigate intermittent iOS simulator VM discovery stalls: the 6 November nightly failed before tests, and run 42353883810 passed after the existing single simulator restart. Preserve bounded recovery and never retry assertion failures.

## Native timezone autocomplete

- [x] Reproduce missing suggestions with the real `{value, city}` catalog shape; the old string-only filter discarded every entry, and simplified test fixtures hid the mismatch.
- [x] Search the catalog's city and IANA timezone values, save the canonical selection, and let Flutter place suggestions in the available space around the keyboard.
- [x] Verify narrowing, selection, preserved preferences, invalid input and a tappable dropdown on a compact screen with the keyboard open; all 34 Flutter tests and Dart analysis pass locally.
- [x] Extend the existing native runtime test to search and save a timezone using the real bundled engine catalog.
- [x] Push and verify the updated runtime test inside Android WebView and iOS WKWebView in native run 41630966432; record the passing result and initial simulator setup timeout in RELEASES.md.

## Android offline planner startup

- [x] Reproduce the original loader failure in Android WebView: diagnostic run 41601164582 shows the initial `data:` document denied with HTTP 403, followed by the exact reported error.
- [x] Serve Android's exact initial planner document from bundled memory while keeping other requests, filesystem access and remote code blocked; ignore incidental blank-page completion.
- [x] Add focused document-policy tests; all 31 Flutter tests, Dart analysis and Chromium engine parity pass locally.
- [x] Add Android emulator runtime coverage and preserve its driver, emulator, logcat and WebView-provider diagnostics.
- [x] Push the fix and verify native run 41601171116: Android WebView 133 loads the in-memory HTTPS document and completes planning; iOS WKWebView also passes. Record the reproduced old failure and fixed result in RELEASES.md.

## Android builds on Java 25

- [x] Verify Gradle 9.3.1 supports Java 25, the existing Android/Kotlin plugins and the pinned Flutter SDK.
- [x] Upgrade the Gradle distribution and checksum, and select Java 25 for Android CI.
- [x] Verify an Android APK build with Java 25.0.4 and update setup documentation; Gradle 9.3.1 configured successfully and assembled the APK in 119.6 seconds.
- [x] Push the Gradle upgrade and Java 25 CI configuration as 26dd672.
- [x] Confirm native CI 41593062062 passes both platforms and record Java 25.0.4 local / 25.0.5 CI verification. See RELEASES.md.

## Bounded iOS runtime startup

- [x] Isolate the simulator failure to Flutter's VM-service connection discovery; verify the unchanged iOS retry passes.
- [x] Compile the runtime test once and bound connection startup separately from test execution.
- [x] Permit one simulator restart only for an observed VM-service startup timeout before any test starts; preserve assertion failures and cancellation.
- [x] Stream and retain complete driver logs and simulator diagnostics for every attempt, including successful recovery.
- [x] Verify recovery, failure and cancellation behavior with 13 subprocess scenarios and all 597 unit/runtime tests; validate the workflow with actionlint.
- [x] Push the changes and confirm native workflow 41575003127 passes both platforms; inspect the first-attempt iOS runtime result and uploaded diagnostics. See RELEASES.md.

## Accurate account session status

- [x] Reproduce a stale sign-in banner after successful session verification and temporary service responses misclassified as expired sessions.
- [x] Separate cached/offline account access from confirmed authentication failures; retry temporary failures without asking for Google sign-in.
- [x] Clear stale prompts after verification and provide a direct Google reconnect action only when a session needs it; preserve saved settings and pending edits.
- [x] Verify temporary-service recovery and direct session reconnection in Chromium and mobile WebKit, with 584 unit/runtime tests and account-isolation checks passing locally.
- [x] Publish and deploy the verified release after 584 unit/runtime tests and 49 browser scenarios pass; confirm both recovery flows against the deployed frontend with controlled account responses. See RELEASES.md.

## Sleep history and the end of a trip

- [x] Reproduce disappearing sleep on October 24–26 when a recorded activity triggers replanning at a later current time.
- [x] Restore unrecorded historical guidance without treating it as measured sleep or changing the past light inputs; preserve explicit observations.
- [x] End the web, native and exported plan on the day after final arrival, using the arrival timezone; show a Trip complete marker and open completed trips on their final day.
- [x] Verify the real numerical itinerary with recorded history, mobile presentation, overnight sleep and final-day limits; local checks include 579 unit/runtime tests, affected browser journeys and Flutter.
- [x] Publish and deploy the verified release after 579 unit/runtime tests and 48 browser scenarios pass; confirm restored sleep and the October 27 completion marker on the live mobile site. See RELEASES.md.

## Continuous date-line timelines

- [x] Reproduce the October 24–26 AA6276/QF94 timeline overlap, duplicated departures and misleading sleep fragments.
- [x] Partition the journey into adjacent UTC display windows with explicit airport-clock changes and unchanged original recommendation IDs/times.
- [x] Render departure, compact flight continuation and arrival milestones; join midnight sleep fragments for full-duration labels and omit past-origin clocks on destination ground advice.
- [x] Verify full-trip elapsed-time coverage, sleep continuity, both date-line directions, DST and mobile/native presentation; inspect the revised October screens. Local unit/runtime, targeted Chromium/WebKit and Flutter checks passed.
- [x] Publish the checked release after 575 unit/runtime tests and 48 browser scenarios pass; deploy the verified artifact and confirm all three live mobile timelines. See RELEASES.md.

## Selected plan date visibility

- [x] Reproduce a selected current-day timeline with its date hidden offscreen on the mobile date strip.
- [x] Reveal the selected date on opening the plan and when navigating between days; scroll only the date strip and retain manual browsing until the selection changes.
- [x] Verify the date-line itinerary and arrow navigation in Chromium/mobile WebKit; publish the checked release after 567 unit/runtime tests and 47 browser scenarios pass, and confirm the live mobile behavior. See RELEASES.md.

## Flutter for iOS and Android

- [x] Add a native Flutter app alongside React web, with pinned tooling and reusable libraries.
- [x] Bundle the exact TypeScript planner, clock/timeline helpers, lounge rules and datasets for offline native use.
- [x] Add native Google token exchange and revocable bearer sessions without relaxing browser authentication.
- [x] Add separate guest/account caches, secure credential storage and revision-aware automatic account saves.
- [x] Implement Today, Plan, Trips, Lounges and Profile with native controls and existing UX refinements.
- [x] Verify the integrated app, offline native engine, Android APK and unsigned iOS compilation; 25 Flutter tests, two iOS runtime tests, 567 unit/runtime tests and 46 browser scenarios passed. See RELEASES.md.
- [ ] Register native Google OAuth clients/signing fingerprints, configure the Worker allowlist, and verify real-device account/provider flows.
- [ ] Choose distribution/signing for device testing and review store submission requirements, including Apple login policy before public iOS distribution.

## Retain stay days after replanning

- [x] Reproduce missing Sunday 18 October in Honolulu after a recorded activity triggers future-only replanning.
- [x] Keep preparation and stay dates from the original itinerary stages even without action cards; preserve action IDs, timing and available estimates.
- [x] Show a neutral empty state instead of an all-day Awake band when no guidance exists.
- [x] Verify the recorded-activity browser journey, publish the checked release and confirm the live date strip at desktop/mobile widths; 539 unit/runtime tests and 46 browser scenarios passed. See RELEASES.md.

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
- [ ] Later: verified codeshare aliases, opt-in push delivery and flight-update review in the Flutter client.

## Owner acceptance and research

- [ ] Confirm the exact Honolulu 01:42 bedtime against the traveler’s actual saved preferences, trip details and recorded sleep when supplied.

- [ ] Verify revised automatic account saving, account switching, offline edits/reconnection and deletion with real Google accounts/devices.
- [ ] Confirm signed-in booked-flight import and representative future +60/+90/+150-day coverage with the configured provider.
- [ ] Verify lounge memberships and boarding-pass eligibility against real bookings; extend airport research and licensed photos.
- [ ] Confirm physical-device Safari/date/timezone interactions, native scrolling, background/resume behavior and interrupted runtime recovery.
- [ ] Obtain independent scientific/clinical review before making claims about personal outcomes; numerical verification is not clinical validation.

## Deliberate future decisions

- [ ] Decide whether to migrate old rules-mode preferences and retire that planner; preserve existing behavior until then.
- [ ] Broader notification, accessibility/localization and store distribution should follow device testing and actual usage.
