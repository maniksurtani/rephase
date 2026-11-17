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
| 1 | DXB, ICN, AMS, IST, CDG | Largest uncovered international gateways; include airline and independent options and distinct airside zones | Research in progress |
| 2 | HKG, FRA, DOH, JFK, ORD | Additional alliance hubs and North American gateways | Queued |
| 3 | BKK, KUL, TPE, HND, NRT | Broader Asian connectivity; separate Tokyo airports | Queued |
| 4 | DFW, EWR, ATL, YYZ, YVR | North American connecting traffic and Canada | Queued |
| 5 | DEL, BOM, PVG, PEK, CAN | India and mainland China; prioritise reliable local-language sources | Queued |
| 6 | MAD, FCO, BCN, MEX, GRU | Southern Europe and major Latin American gateways | Queued |
| 7 | JNB, ADD, NBO, CMN, CAI | African gateways and intercontinental connections | Queued |
| 8 | MEL, BNE, PER, AKL, AUH | Oceania and additional Gulf coverage | Queued |

This is an initial queue, not a commitment to wait through every preceding batch. Actual demand can advance any airport. Further candidates include SEA, IAH, MIA, BOS, ZRH, VIE, HEL, CPH, WAW, PTY, BOG, LIM, SCL, CPT, DPS, MNL and CGK. Review geographic gaps after each two batches.

## Definition of a useful first guide

- Inventory the principal departure zones before selecting lounges. Include major hub-airline/status options and a verified membership alternative where available. Never invent Priority Pass participation to satisfy that target.
- Model separate lounges separately: First versus Business, Schengen versus non-Schengen, different terminals and different concourses. Airport presence alone is not evidence of usable coverage.
- For each published record, read official location, access and facilities sources; record their actual check dates. Encode fare, operating/marketing carrier, status issuer, route, entry window and visit-limit restrictions where supported. Keep unresolved restrictions conditional.
- Use the common review rubric for quality. Historical or hosted reviews must be labelled; no rating without evidence. Operational source dates and editorial rating dates remain separate. Photos are optional and must be licensed.
- Explicitly document omitted lounges, memberships, restricted dining hours, closures and uncertain facilities. Do not silently convert a missing access rule into a claim that no access exists.
- Run existing schema/provenance, access, airport and visit-window tests plus type/build checks. Add only meaningful policy regressions for new exceptions. Verify the same generated data reaches the mobile engine; no duplicated Dart dataset or new backend.
- Commit a reviewable batch and update this table. Website deployment and native distributions are separate release steps; installed apps do not receive new bundled JSON until rebuilt.

## Existing-guide follow-up queue

1. Complete SYD domestic coverage beyond Qantas; verify NZ partner invitations and paid memberships.
2. Add HNL's central Sakura/Admirals and ANA options; SFO United Club, Maple Leaf and Centurion.
3. Expand SIN SATS/Marhaba locations, premium SilverKris sections and PPS selections.
4. Add remaining LHR airline lounges and MUC K/L satellite lounges; retain terminal/border restrictions.
5. Recheck SLC Sky Club hours, CNS international availability and LAX First reopening before claiming certainty.

## Maintenance and success measures

Recheck popular guides approximately every 90 days, and renovation/closure notices within 30 days or when a traveller reports a change. These are editorial targets, not an automated monitoring promise. Keep source-level check dates intact during partial updates. The existing matcher conservatively flags stale research after 180 days.

Track the share of actual departure/connection opportunities with useful guidance, including relevant terminal, membership and visiting time. Also track unsupported searches and stale records. Until we have measured usage, report airport/lounge counts as inventory only; do not claim a percentage of travellers covered.

Keep the data under `data/lounges/`, with the existing schema and automatic discovery on web and Flutter. No runtime lounge API, scraper service, ratings database or additional analytics infrastructure is required for these batches.
