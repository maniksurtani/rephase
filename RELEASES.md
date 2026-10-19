# Release evidence

## 18 October 2026 — native Flutter apps for iOS and Android

Source [`e397cfc`](https://github.com/maniksurtani/rephase/commit/e397cfc1dbaaca4575f6c9e805e0e2fe10dafafd). [Checks 39183153696](https://github.com/maniksurtani/rephase/actions/runs/39183153696) passed formatting, lint, frontend/Worker TypeScript, all 567 unit/runtime tests across 44 suites and all 46 browser scenarios. Verified artifact `12157036544` contains the existing 26 web offline assets and shell `df48076eeae4ea04`.

[Mobile checks 39183153695](https://github.com/maniksurtani/rephase/actions/runs/39183153695) passed Flutter formatting and analysis, all 25 focused data/widget tests, exact Chromium engine parity, the Android APK build and unsigned iOS Simulator compilation. Both native integration tests passed inside iOS WKWebView in ten seconds: the default scientific planner and cached clock refresh, plus DST gap/fold handling. The workflow uses Flutter's official integration driver. The [CI Android APK](https://github.com/maniksurtani/rephase/actions/runs/39183153695/artifacts/12157496266) is retained for 14 days.

The app adds native Today, Plan, Trips, Lounges and Profile screens, preserving the compressed timeline, city labels, both flight clocks, preflight lounge links and folded details. The bundled TypeScript engine and datasets retain offline calculations and lounge matching; no scientific equations changed. Native state uses account-isolated atomic files, Keychain/Keystore credentials, automatic revision-checked saves and the shared merge algorithm. Renderer-loss callbacks invalidate interrupted runtimes so the next request can initialize afresh. Android permissions were checked in the built APK: Internet and an internal AndroidX signature permission, with no biometric, location or storage permissions.

The compatible Worker was published from verified source [`c90ed24`](https://github.com/maniksurtani/rephase/commit/c90ed2414db9cc526966e3673dd804df947ba99e) through [deployment 39180029918](https://github.com/maniksurtani/rephase/actions/runs/39180029918), reusing artifact `12154913225` from [Checks 39178917504](https://github.com/maniksurtani/rephase/actions/runs/39178917504). No migrations were needed. Worker version: `17788661-d239-4978-90a4-cfa1dcc0b164`. Native Google exchange uses an explicit presenter allowlist and revocable opaque sessions; browser authentication remains covered by its existing tests. Subsequent changes affect mobile code, tooling and documentation. Live native-style GET checks returned public configuration as JSON/200 and the Google exchange route as JSON/405 with `Allow: POST`; no account writes or provider calls occurred.

The provided local Android debug APK was built from `c9d3a88`, whose app code matches `e397cfc`. SHA-256: `7216684ba8f25389312aa6dc4221233c8307492f378de10ceb3220d963f14c73`. Its debug signing certificate SHA-1 is `AD:4A:8E:01:B6:42:0A:24:D7:9A:AD:F2:DB:E2:DD:0E:C9:6B:EA:4B`; register that fingerprint if testing Google login on this specific APK. GitHub's APK uses a different ephemeral debug certificate.

Guest manual planning and bundled lounges need no credentials. Native Google clients, the Worker presenter allowlist, real-account/provider flows and physical-device background/recovery checks still need owner acceptance. iPhone signing and store distribution are separate steps; no store upload or signed iOS release was performed. See [mobile setup](mobile/README.md) and [remaining tasks](TODO.md).

## 18 October 2026 — retain stay dates after recorded activity

Source [`4f40c88`](https://github.com/maniksurtani/rephase/commit/4f40c88ab7e55cd35fa95bb0cff5e6ded4a2aee7). [Checks 39176037010](https://github.com/maniksurtani/rephase/actions/runs/39176037010) passed lint, formatting, frontend/Worker TypeScript, all 539 unit/runtime tests across 42 suites and all 46 browser scenarios (1.5 minutes). Verified artifact `12153589289` contains 26 offline assets, shell `df48076eeae4ea04`.

[Deployment 39176286063](https://github.com/maniksurtani/rephase/actions/runs/39176286063) reused that exact artifact without repeating browser tests. No migrations were needed. Worker upload version: `202a0614-24cb-4edd-a2cc-bba71ff545d6`.

The October itinerary reproduced the missing Sunday 18 October at 13:13 Honolulu after recording preparation sleep. Future-only replanning removed unlogged recommendations, and calendar generation had relied on those actions to create stay dates. Preparation/stay dates now come from the original ground stages even when no cards remain. Empty days show a neutral message instead of an all-day Awake band. Recommendations, recorded IDs, numerical timing and estimate rules are unchanged. The focused regression verifies retained dates and future-only actions; the existing browser journey covers the actual Record UI, Sunday selection, Monday's flight and mobile reload.

Live guest checks confirmed the exact entry asset/offline shell, ordered unique dates 14–19, selectable Sunday in Honolulu, its neutral empty state and Monday's AS812. Inspected desktop/390px screenshots fit without horizontal overflow. No page errors, account writes or flight-provider calls occurred. The temporary smoke harness was corrected to await the asynchronous planner before reading the date strip.

## 18 October 2026 — collapsible melatonin guidance

Source [`cf54c5b`](https://github.com/maniksurtani/rephase/commit/cf54c5bbe24c7799a04b6b2dbf844b3aba5424dd). [Checks 39100247484](https://github.com/maniksurtani/rephase/actions/runs/39100247484) passed lint, formatting, frontend/Worker TypeScript, all 538 unit/runtime tests across 42 suites and all 46 browser scenarios (1.2 minutes). Verified artifact `12126262454` contains 26 offline assets, shell `8697420e7724191a`.

[Deployment 39100400249](https://github.com/maniksurtani/rephase/actions/runs/39100400249) reused that exact artifact. No migrations were needed. Worker upload version: `82f15684-12db-4073-86d3-f03ecf1a0a31`.

Optional melatonin cards keep their time visible and fold usage text, dose information, explanation and source under **Melatonin guidance**, closed by default in Plan and both Today surfaces. The existing mobile preferences journey now verifies tap expansion/collapse and keyboard Enter/Space behavior. No model or recommendation timing changes.

Live checks confirmed the exact entry asset and offline shell, default-hidden guidance and tap expansion/collapse in all three surfaces, Plan keyboard interaction and expanded layout at 390px/1440px. Screenshots were inspected. Only an isolated browser-local guest fixture was seeded; no page errors, account writes, sign-in or flight-provider calls occurred.

## 18 October 2026 — current guidance and preflight lounge links

Source [`5f497d2`](https://github.com/maniksurtani/rephase/commit/5f497d24763a670a9eef39faad399da75eff46c0). [Checks 39088578676](https://github.com/maniksurtani/rephase/actions/runs/39088578676) passed formatting/hooks lint, frontend/Worker TypeScript, 538 unit/model/API/runtime tests across 42 suites, the build and all 46 browser cases (1.8 minutes). Verified artifact `12121119127` contains 26 offline assets, shell `7aa5586cae3f5ab8`.

[Deployment 39088797499](https://github.com/maniksurtani/rephase/actions/runs/39088797499) reused that exact artifact; no migration or configuration changes were needed. Worker upload version: `7ebd69b7-bdf5-48f1-a0e6-67161938a01f`. Live desktop/390px checks seeded only an isolated guest copy of the public October fixture, fixed the device clock to Saturday 17 October 15:45 Honolulu, and confirmed elapsed advice/arrived flights are hidden, the next bedtime is dated, lounge links precede departures and Explorer opens. Entry assets/offline shell match; no page errors, Google sign-in, account writes or flight requests occurred.

The scientific model is unchanged. A new coarse regression preserves gradual Sydney-to-Honolulu sleep adjustment, eight-hour duration and convergence to the preferred local wake time. An after-midnight bedtime can be transitional: 23:00 Sydney corresponds to 02:00 Honolulu in October. The exact user screenshot's 01:42 depends on their saved preferences, schedule/strategy and sleep history; its past/upcoming meaning also depends on the device's local date. Personal confirmation remains in TODO.md.

## 16 October 2026 — code-review refactor

Source [`b492a43`](https://github.com/maniksurtani/rephase/commit/b492a4343ab3fea07ed3ffc150832b87cba06ff7), following formatting-only commit `be05ee1`. [Checks 38861321350](https://github.com/maniksurtani/rephase/actions/runs/38861321350) passed lint, formatting, frontend/Worker TypeScript, 525 unit/model/API/runtime tests across 41 suites, the build and all 43 Chromium/mobile WebKit scenarios (1.9 minutes). Verified artifact `12029004561` contains 26 offline assets, shell `0210f481e2604036`.

[Deployment 38861685688](https://github.com/maniksurtani/rephase/actions/runs/38861685688) published that exact artifact without rebuilding or repeating browsers; migrations were already current. Worker upload version: `01666352-f00b-4cb4-bebc-4b944f483480`. Production desktop/390px checks passed planning, Lounge Explorer, exact entrypoint/assets/offline shell and viewport fit, with no page errors, account writes, sign-in or provider requests.

The planner Worker is 205 KB minified (about 62 KB gzip), approximately 84% smaller. Main JavaScript retains the complete airport search catalog; the fallback planner is a separate 41 KB chunk. Six pre/post planning scenarios retain identical guidance aside from generated metadata. Local checks also passed the complete suite and nine affected scenarios after the final CSS cleanup.

Earlier evidence is preserved in [the verification archive](docs/archive/VERIFICATION-2026-10-16.md) and [completed task archive](docs/archive/TODO-2026-10-16.md). Real-account and real-provider acceptance remains in [TODO.md](TODO.md).
