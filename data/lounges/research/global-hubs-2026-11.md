# Global hub expansion: integration and evidence

Research/integration date: 18 November 2026. Working scope and per-region evidence are linked from [EXPANSION.md](../EXPANSION.md). Counts describe selected guides, not guaranteed access or an exhaustive inventory.

## Shared airline and country support

Add the operating/marketing airline choices needed by the new hubs, and explicit airport-to-country mappings so domestic routes and border-zone restrictions can be evaluated. Airline choice does not grant a lounge entitlement by itself. Specific lounge rules and conditions still decide access.

- **ITA / AZ → Star Alliance:** the [Lufthansa Group announcement](https://newsroom.lufthansagroup.com/en/ita-airways-joins-star-alliance/), opened 18 November 2026, confirms entry on 1 April 2026. Earlier SkyTeam references and pre-entry lounge rules must not be reused.
- **SAS / SK remains SkyTeam:** [SAS's current alliance page](https://www.flysas.com/gb-en/about-us/skyteam), opened 18 November 2026, confirms its current membership. A Star Alliance Gold card alone does not follow an old SAS affiliation.
- **LATAM / LA and JJ are not oneworld:** [oneworld's departure announcement](https://www.oneworld.com/news/2020-01-31-LATAM-to-leave-oneworld-effective-1-May-2020) establishes the 2020 withdrawal. Current bilateral privileges require their own eligibility rule, not a generic oneworld inference.
- **China Southern / CZ is not SkyTeam:** [China Southern's transition announcement](https://www.csair.com/sg/en/about/news/news/2019/1dsrfdovckaid.shtml) distinguishes withdrawal from continuing bilateral partners. Older FAQs still mentioning membership are not current membership evidence.
- **Philippine Airlines / PR:** the airline-partner [Mabuhay Miles Status Match FAQ](https://philippineairlines.statusmatch.com/faq/), opened 18 November 2026, explicitly says oneworld benefits start only after full integration. The airline press-release URL rendered only a JavaScript shell during this check. Do not enable generic alliance privileges from an announcement of future entry.
- **Etihad / EY:** [Etihad Guest's partner directory](https://www.etihad.com/en-us/etihadguest/our-partners) describes bilateral airline partners. Treating those partners as one shared lounge alliance would be incorrect.

New airline names and country mappings are shared application code. They require a new native build to appear in installed selectors, unlike compatible airport-guide content updates. Older clients continue treating missing airline/country context as uncertain; published rules still include explicit carrier/country restrictions.

## Verification approach

Run schema/semantic checks for all source files, with duplicate lounge IDs and safe external links checked globally. Test newly introduced access exceptions using the real access matcher; ensure every explicitly referenced airline is available in the selector and every covered airport has a known country and valid timezone. Build the static per-airport manifest and validate web/native shared-engine parity. Keep network photo links external and retain reviewed-source dates without pretending that every older record was rechecked.

Regional notes record pages that were inaccessible, unverified facilities/hours, older reviews and excluded lounges. Unreviewed quality is represented by an absent score. A launch-visit review is not evidence of ordinary peak-hour crowding, and a predecessor lounge's rating does not silently transfer to its replacement.

## Integration results

The combined catalog contains 61 airports / 165 lounges. All 205 focused catalog, access, country, cache and shared-mobile-engine tests passed; type checking, lint, formatting and production build passed. The generated manifest resolves 61 content-hashed JSON downloads with 165 records. The mobile-width browser check includes FRA, JFK, HKG, BKK, DOH and GRU; all seven lounge browser scenarios passed after replacing the old “MEL is uncovered” fixture with ADL. No full native rebuild or distribution is needed to validate these content files.

Independent regional cross-checks covered Europe, North America and Gulf/Africa. Corrections include Qatar fare-versus-status separation, Delta’s non-Delta SkyTeam premium route and every-segment requirement, JFK international-only status rules, United’s same-calendar-day boarding pass, and Etihad’s 3.5-hour/overnight-transfer and Business Value restrictions. Eighteen unreviewed quality scores are explicitly tracked in `quality-backlog.json`.
