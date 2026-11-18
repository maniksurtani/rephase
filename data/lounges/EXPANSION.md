# Global lounge coverage plan

Owner: Rephase maintainers. Planned 17 November 2026. Status is curated guide coverage, not a claim that every lounge or access route at an airport is supported.

## Prioritisation

Start with international passenger volume and connection usefulness, then adjust for observed demand, terminal gaps and research effort. The initial audience is global: the owner's Australian travel is useful feedback but does not define the ranking.

The [ACI 2025 international passenger table](https://aci.aero/resources/busiest-airports-in-the-world/) and [OAG Megahubs 2026](https://www.oag.com/megahubs-2026) were consulted on 17 November 2026. ACI measures passenger movements; OAG measures potential connections on a representative busy day. Neither measures Rephase usage or guaranteed lounge demand. The first batch is the five highest-volume international airports absent from our nine-airport seed set. Later batches mix large hubs and regional coverage rather than pretending to be a precise traffic ranking.

When useful aggregate usage becomes available, reorder after each batch using distinct travellers' departure/connection opportunities and unsupported searches. Avoid counting an arrival and its connecting departure twice; exclude demo trips and give final arrivals lower weight. Do not collect new analytics as part of this data-only expansion. A manually maintained request queue is sufficient initially.

## Batches

| Batch | Airports | Purpose | Status |
| --- | --- | --- | --- |
| Existing guides | SYD, HNL, SIN, LHR, SFO | Eight missing options, including domestic/status distinctions and current refurbishment restrictions | Implemented in `563aca9`; remaining gaps below |
| 1 | DXB, ICN, AMS, IST, CDG | Largest uncovered international gateways; include airline and independent options and distinct airside zones | Selected guides added; AMS/CDG/ICN airline gaps expanded 18 November |
| 2 | HKG, FRA, DOH, JFK, ORD | Additional alliance hubs and North American gateways | Selected guides added 18 November; gaps in regional notes |
| 3 | BKK, KUL, TPE, HND, NRT | Broader Asian connectivity; separate Tokyo airports | Selected guides added 18 November; gaps in regional notes |
| 4 | DFW, EWR, ATL, YYZ, YVR | North American connecting traffic and Canada | Selected guides added 18 November; gaps in regional notes |
| 5 | DEL, BOM, PVG, PEK, CAN | India and mainland China; prioritise reliable local-language sources | Selected guides added 18 November; gaps in regional notes |
| 6 | MAD, FCO, BCN, MEX, GRU | Southern Europe and major Latin American gateways | Selected guides added 18 November; gaps in regional notes |
| 7 | JNB, ADD, NBO, CMN, CAI | African gateways and intercontinental connections | Selected guides added 18 November; gaps in regional notes |
| 8 | MEL, BNE, PER, AKL, AUH | Oceania and additional Gulf coverage | Selected guides added 18 November; gaps in regional notes |

This is an initial queue, not a commitment to wait through every preceding batch. Actual demand can advance any airport. The 18 November parallel expansion also includes SEA, IAH, MIA, ZRH, HEL, CPH, PTY, BOG, SCL, MNL and CGK. Further candidates are listed below. Review geographic gaps after each two batches.

## Definition of a useful first guide

- Inventory the principal departure zones before selecting lounges. Include major hub-airline/status options and a verified membership alternative where available. Never invent Priority Pass participation to satisfy that target.
- Model separate lounges separately: First versus Business, Schengen versus non-Schengen, different terminals and different concourses. Airport presence alone is not evidence of usable coverage.
- For each published record, read official location, access and facilities sources; record their actual check dates. Encode fare, operating/marketing carrier, status issuer, route, entry window and visit-limit restrictions where supported. Keep unresolved restrictions conditional.
- Use the common review rubric for quality. Historical or hosted reviews must be labelled; no rating without evidence. Operational source dates and editorial rating dates remain separate. External photo/review page links are preferred; any embedded photos must be licensed.
- Explicitly document omitted lounges, memberships, restricted dining hours, closures and uncertain facilities. Do not silently convert a missing access rule into a claim that no access exists.
- Run existing schema/provenance, access, airport and visit-window tests plus type/build checks. Add only meaningful policy regressions for new exceptions. Verify both clients validate the same downloadable schema and access rules; no duplicated Dart dataset or new backend.
- Commit a reviewable batch and update this table. Compatible guide updates publish through the normal web deployment and reach clients using on-demand guides. Shared airline, access-engine or schema changes still require a mobile release; older clients keep conservative unknown-carrier/country handling.

## Existing-guide follow-up queue

1. Complete SYD domestic coverage beyond Qantas; verify NZ partner invitations and paid memberships.
2. Add HNL's central Sakura/Admirals and ANA options; SFO United Club, Maple Leaf and Centurion.
3. Expand SIN SATS/Marhaba locations, premium SilverKris sections and PPS selections.
4. Add remaining LHR airline lounges and MUC K/L satellite lounges; retain terminal/border restrictions.
5. Recheck SLC Sky Club hours, CNS international availability and LAX First reopening before claiming certainty.

## Batch 1: initial implementation and remaining work

The first pass adds nine lounges and brings the dataset to **59 selected lounges at 14 airports**. This starts the batch; it does not yet meet the full useful-guide target at every airport.

| Airport | Implemented | Next research within this batch |
| --- | --- | --- |
| DXB | Emirates Business B; Plaza Premium T3 A | Verify Emirates fixed hours and dining style; add T1 independent options and other Emirates concourses/First. Review Qantas/flydubai reciprocity separately. |
| ICN | Matina T2 | Add current Korean Air lounges following the 2025–26 renovations, plus T1 coverage. Avoid applying old West Lounge reviews to the replacement. |
| AMS | Aspire 26 Schengen and 41 non-Schengen | Add KLM Crown 25/52 and oneworld; verify current Business Light exclusions. The KLM pages were inaccessible during this pass, so eligibility was not inferred from search snippets. |
| IST | Turkish international Business and Miles&Smiles; iGA international | Domestic options, paid club/corporate invitations and reviews of the recent Turkish expansion. Resolve Priority Pass's conflicting textual/structured visit limits against current member entitlement. |
| CDG | New T1 non-Schengen Star Alliance lounge | Air France 2F/2E, separate Schengen options and independent lounges. Air France pages were inaccessible during this pass; no SkyTeam/paid/PP access is invented for the Star Alliance lounge. |

These are the original 17 November gaps. The parallel expansion adds Korean Air at ICN, KLM Crown at AMS and Air France at CDG; remaining terminal, opening-hour and access-route gaps stay in the regional notes. Follow up in parallel with geographic expansion. Keep private sleep-suite eligibility separate from ordinary lounge access. Last-entry and gate restrictions the matcher cannot resolve remain explicit conditions; no gate-entry fields were added to trips.

## Maintenance and success measures

Recheck popular guides approximately every 90 days, and renovation/closure notices within 30 days or when a traveller reports a change. These are editorial targets, not an automated monitoring promise. Keep source-level check dates intact during partial updates. The existing matcher conservatively flags stale research after 180 days.

Track the share of actual departure/connection opportunities with useful guidance, including relevant terminal, membership and visiting time. Also track unsupported searches and stale records. Until we have measured usage, report airport/lounge counts as inventory only; do not claim a percentage of travellers covered.

Keep the data under `data/lounges/`, with the existing schema and automatic discovery on web and Flutter. No runtime lounge API, scraper service, ratings database or additional analytics infrastructure is required for these batches.

## Parallel global hub expansion — 18 November 2026

The working scope is **61 airports**: 14 existing guides plus 47 additional international gateways/transfer hubs. “Tier 1” here is an editorial working list, not an official airport classification or a claim of complete worldwide coverage. It combines all queued batches with additional major regional connection points; existing smaller requested airports remain supported. All six regional tracks ran concurrently, as requested. The result is **165 selected lounges (106 added)**, with 147 sourced quality assessments and 18 explicit review-backlog entries. See the [coverage and size snapshot](COVERAGE.md).

| Regional track | New airports | Existing guide gaps assigned | Status |
| --- | --- | --- | --- |
| Europe | FRA, MAD, FCO, BCN, ZRH, CPH, HEL | AMS, CDG | 21 added lounges; [evidence and gaps](research/europe-2026-11.md) |
| North America | JFK, ORD, DFW, EWR, ATL, YYZ, YVR, SEA, IAH, MIA, DEN | — | 22 added lounges; [evidence and gaps](research/north-america-2026-11.md) |
| East Asia | HKG, TPE, HND, NRT, PVG, PEK, CAN | ICN | 20 added lounges; [evidence and gaps](research/east-asia-2026-11.md) |
| South/Southeast Asia | BKK, KUL, DEL, BOM, CGK, MNL | — | 11 added lounges; [evidence and gaps](research/south-southeast-asia-2026-11.md) |
| Gulf and Africa | DOH, AUH, JNB, ADD, NBO, CMN, CAI | DXB where evidence permits | 15 added lounges; [evidence and gaps](research/gulf-africa-2026-11.md) |
| Oceania and Latin America | MEL, BNE, PER, AKL, MEX, GRU, PTY, BOG, SCL | — | 17 added lounges; [evidence and gaps](research/oceania-latin-america-2026-11.md) |

The acceptance target is a useful guide for each airport, not a synthetic minimum lounge count. Research should cover principal airline/status options plus a verified independent membership alternative where one can be established. Missing operational evidence stays unknown or conditional; a search snippet alone does not establish access, hours or facilities. Unavailable independent review evidence means no quality score, rather than an invented rating. Regional evidence notes live under `research/`.

Follow-on tier review: BOS, IAD, CLT, DTW, MSP, VIE, WAW, LGW, DUB, ARN, OSL, BRU, LIS, KIX, SZX, PKX, TFU, SGN, HAN, DPS, JED, RUH, BAH, KWI, LIM, SJO, SJU and CPT. Promote gaps based on connection utility and actual demand; do not call the initial working list exhaustive.
