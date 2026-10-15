# Data and evidence sources

Last checked: 2026-10-14. No airport-data service is called by the browser at runtime.

## Worldwide airport catalog

Rephase bundles **7,884 IATA-coded airports** from [Mike Borsetti's airportsdata](https://github.com/mborsetti/airportsdata), an MIT-licensed dataset. This includes regional destinations and fractional-offset zones, not just major hubs. Records without IATA codes are excluded: the source's full 28,298-airport list includes many small or private fields that cannot be selected by a three-letter IATA code.

Each bundled record preserves the source's IATA code, airport name, city, IANA time zone, latitude, and longitude. City may be empty where the source does not supply it. Coordinates identify the airport, not the traveler's exact location or the aircraft's in-flight position. The lookup does not fabricate a timezone for an unknown airport.

The source is pinned to commit [`47ae282a8491758e6dafe28d4139539e561b54d5`](https://github.com/mborsetti/airportsdata/tree/47ae282a8491758e6dafe28d4139539e561b54d5), committed **2026-09-05**. The generated catalog is sorted by IATA code. `findAirport()` uses an in-memory map for constant-time code lookup and retains case/whitespace normalization.

`airport-catalog.js` imports the JSON for normal Vite/Worker bundling; its companion declaration exposes the validated `Airport[]` contract to TypeScript. This avoids expensive structural inference across thousands of JSON record literals during app and Worker checks. The maintenance generator and complete-record tests validate the data behind that declaration.

| Source artifact | SHA-256 |
| --- | --- |
| `airportsdata/airports.csv` | `516c57d9d999f7a3be28ca649d2badbe3b972f07e57dc6173ab973b72d51cf52` |
| `LICENSE` | `1ab6bf365e1f6a1883ab6a2f797e761b221081b52a33273d86c157fd562106be` |

The original MIT notice, including attribution to Mike Borsetti and the upstream mwgg/Airports project, is shipped unchanged at [public/data-licenses/airportsdata-LICENSE.txt](public/data-licenses/airportsdata-LICENSE.txt). Machine-readable provenance is at [public/data-licenses/airportsdata-source.json](public/data-licenses/airportsdata-source.json). Both are included in the static deployment.

The upstream data is community maintained and is provided without a warranty. It is not a flight schedule, and a code's presence does not imply a currently operating commercial flight. Airport codes, names, and timezone laws can change. Users can correct an itinerary's explicit IANA zones; actual schedules should be confirmed with the carrier. Timezone arithmetic uses browser/runtime timezone rules, including daylight saving and half/quarter-hour offsets, rather than fixed country offsets.

### Reproduce or refresh

From the repository root, with Node and network access:

```bash
node scripts/update-airports.mjs
node scripts/update-airports.mjs --check
```

The script fetches only the pinned CSV/license, verifies their hashes, rejects duplicate or malformed IATA codes and invalid coordinates, and validates every distinct time zone against `Intl.DateTimeFormat`. Records with missing or unrecognized time zones are excluded and listed in provenance. The current snapshot has **zero excluded IATA records**. It never guesses a replacement zone or installs a package.

`--check` regenerates in memory and compares the catalog and attribution without writing them. For proxy-controlled environments on Node 24, use `NODE_USE_ENV_PROXY=1 node scripts/update-airports.mjs --check`. For offline reproduction, first download the two pinned artifacts and pass their local paths:

```bash
node scripts/update-airports.mjs --check --source /path/to/airports.csv --license /path/to/LICENSE
```

The same checksum validation applies to local files. To intentionally refresh the catalog, review a new upstream commit/license and update the pinned commit, date, and hashes in the maintenance script. Regenerate and review the diff, excluded-record report, and airport tests before committing. The generating runtime's IANA support affects validation; use the project's supported Node release and investigate exclusions before updating a snapshot.

`tests/airports.test.ts` checks unique codes, sort order, zones, coordinates, lookup normalization, and fractional/DST/date-line examples including Kathmandu, Paro, Chatham Islands, Lord Howe Island, Samoa, and American Samoa.

## Public science explanation

[public/science.html](public/science.html) is a standalone informational page with plain-language explanations and links to the source publications. It requires no JavaScript or login; its typography is bundled locally. The prose is original and summarizes evidence rather than copying proprietary app content or journal text.

The page distinguishes clinical guidance, controlled laboratory studies, traveler observations, and mathematical simulations. It explicitly distinguishes evidence supporting a principle from validation of Rephase itself. The prototype does not claim a measured circadian phase or equivalence to Timeshifter's algorithm.

| Source | Used for |
| --- | --- |
| [CDC Yellow Book 2026: Jet Lag Disorder](https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html) | Clinical baseline for timed light, sleep, short stays, caffeine and general 0.5–1 mg melatonin information. |
| [Khalsa et al. 2003](https://pubmed.ncbi.nlm.nih.gov/12717008/) | Biological-time-dependent response to light. |
| [Burgess et al. 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2928909/) | Melatonin timing and dose-specific phase-response curves. |
| [Reiter et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32894981/) | Uncertainty when estimating circadian phase from habitual sleep markers. |
| [Christensen et al. 2020](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1008445) | Real-world feasibility and adherence to suggested light/sleep schedules. |
| [Huang et al. 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC13267907/) ([DOI](https://doi.org/10.1093/sleep/zsag063)) | Group-average modeling of 55,296 flight itineraries; not a Rephase efficacy trial. The publisher DOI endpoint was access restricted during review; the full article was read through Europe PMC's NIH-hosted article record. |
| [NCCIH: Melatonin](https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know) | Safety, interactions, special populations and supplement variability. |
| [Drake et al. 2013](https://pubmed.ncbi.nlm.nih.gov/24235903/) | Sleep disruption from a substantial caffeine dose up to six hours before bed. |
| [Gardiner et al. 2023](https://pubmed.ncbi.nlm.nih.gov/36870101/) | Systematic review of caffeine timing, dose and subsequent sleep. |
| [Forger, Jewett & Kronauer 1999](https://doi.org/10.1177/074873099129000867) | Published light-driven circadian oscillator used by the experimental planner. |
| [Arcascope circadian, pinned reference](https://github.com/Arcascope/circadian/tree/db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a) | MIT-licensed reference implementation for Forger99, numerical agreement checks and attribution. |

The **eight-hour caffeine cutoff** is an intentionally conservative product rule, not an exact biological boundary for every traveler. The **30-minute takeoff and 45–60-minute landing sleep exclusions** are user-requested operational assumptions, not medical treatment effects. Lie-flat availability affects practical sleep opportunities; it does not establish a validated individual circadian adjustment rate.

The experimental planner's Forger99 port is numerically compared against independent upstream-equation calculations for frozen scenarios. This establishes agreement with those equations, not clinical efficacy, the accuracy of an individual's starting phase, or the quality of the schedule-search objective. The model assumes light exposure, represents sleep opportunities as darkness, and does not physiologically simulate sleep debt, sleep quality, caffeine, or melatonin. The ±2-hour baseline sensitivity scenarios are not confidence bounds. See [src/lib/circadian/README.md](src/lib/circadian/README.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for methods and attribution. The reference's MIT notice is also shipped at [public/data-licenses/circadian-MIT.txt](public/data-licenses/circadian-MIT.txt).

The research planner's optional melatonin information is restricted to full-duration ground sleep, selected advance schedules, local evening, and a compatible broad estimated biological window. It omits flights, transfers, preparation and delay schedules. These operational exclusions do not establish suitability or optimal individual timing; the displayed range remains general CDC information and its effect is not included in the oscillator.

## Bun evaluation

`node scripts/benchmark-bun.mjs` compares already-installed Node and Bun running the same TypeScript, Vitest, and Wrangler-startup commands. `--runs 1` is a quick compatibility check; `--build` also compares Vite builds and writes only the local build directory. No Bun installation, dependency installation, lockfile migration, remote deployment, or account mutation occurs.

Bun was **not installed in the implementation environment**, so the script reported a skipped comparison. No performance advantage or full Wrangler/Playwright compatibility is claimed. Node/npm remains the verified workflow. Package installation, native lifecycle scripts, browser performance, and Cloudflare runtime performance are outside this benchmark's measurements.

## Lounge research

The starter dataset contains 16 selected lounges at SFO, SYD, HNL and LAX, reviewed on 15 October 2026. Each lounge's JSON has exact official location/program/access-policy URLs, source IDs and check dates. [The editing guide](data/lounges/README.md), [schema](data/lounges/schema.json) and [offline research prompt](data/lounges/RESEARCH_PROMPT.md) explain how to extend it. Facts are summarized independently; no third-party review ratings or unlicensed lounge photos are bundled. The current carrier-alliance snapshot includes [Hawaiian's oneworld entry on 23 April 2026](https://www.oneworld.com/news/oneworld-welcomes-hawaiian-airlines); historical membership changes are not modeled.

Opening hours and access conditions can change, capacity remains operational, and omission from the curated sample does not establish that a lounge or access right is unavailable. Static editorial tags influence ranking only after confirmed access, opening and usable-visit checks. Pre-flight/arrival/boarding buffers are adjustable product assumptions, not live airport queue data.
