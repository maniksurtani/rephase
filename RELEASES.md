# Release evidence

## 18 October 2026 — current guidance and preflight lounge links

Source [`5f497d2`](https://github.com/maniksurtani/rephase/commit/5f497d24763a670a9eef39faad399da75eff46c0). [Checks 39088578676](https://github.com/maniksurtani/rephase/actions/runs/39088578676) passed formatting/hooks lint, frontend/Worker TypeScript, 538 unit/model/API/runtime tests across 42 suites, the build and all 46 browser cases (1.8 minutes). Verified artifact `12121119127` contains 26 offline assets, shell `7aa5586cae3f5ab8`.

[Deployment 39088797499](https://github.com/maniksurtani/rephase/actions/runs/39088797499) reused that exact artifact; no migration or configuration changes were needed. Worker upload version: `7ebd69b7-bdf5-48f1-a0e6-67161938a01f`. Live desktop/390px checks seeded only an isolated guest copy of the public October fixture, fixed the device clock to Saturday 17 October 15:45 Honolulu, and confirmed elapsed advice/arrived flights are hidden, the next bedtime is dated, lounge links precede departures and Explorer opens. Entry assets/offline shell match; no page errors, Google sign-in, account writes or flight requests occurred.

The scientific model is unchanged. A new coarse regression preserves gradual Sydney-to-Honolulu sleep adjustment, eight-hour duration and convergence to the preferred local wake time. An after-midnight bedtime can be transitional: 23:00 Sydney corresponds to 02:00 Honolulu in October. The exact user screenshot's 01:42 depends on their saved preferences, schedule/strategy and sleep history; its past/upcoming meaning also depends on the device's local date. Personal confirmation remains in TODO.md.

## 16 October 2026 — code-review refactor

Source [`b492a43`](https://github.com/maniksurtani/rephase/commit/b492a4343ab3fea07ed3ffc150832b87cba06ff7), following formatting-only commit `be05ee1`. [Checks 38861321350](https://github.com/maniksurtani/rephase/actions/runs/38861321350) passed lint, formatting, frontend/Worker TypeScript, 525 unit/model/API/runtime tests across 41 suites, the build and all 43 Chromium/mobile WebKit scenarios (1.9 minutes). Verified artifact `12029004561` contains 26 offline assets, shell `0210f481e2604036`.

[Deployment 38861685688](https://github.com/maniksurtani/rephase/actions/runs/38861685688) published that exact artifact without rebuilding or repeating browsers; migrations were already current. Worker upload version: `01666352-f00b-4cb4-bebc-4b944f483480`. Production desktop/390px checks passed planning, Lounge Explorer, exact entrypoint/assets/offline shell and viewport fit, with no page errors, account writes, sign-in or provider requests.

The planner Worker is 205 KB minified (about 62 KB gzip), approximately 84% smaller. Main JavaScript retains the complete airport search catalog; the fallback planner is a separate 41 KB chunk. Six pre/post planning scenarios retain identical guidance aside from generated metadata. Local checks also passed the complete suite and nine affected scenarios after the final CSS cleanup.

Earlier evidence is preserved in [the verification archive](docs/archive/VERIFICATION-2026-10-16.md) and [completed task archive](docs/archive/TODO-2026-10-16.md). Real-account and real-provider acceptance remains in [TODO.md](TODO.md).
