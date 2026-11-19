# Lounge coverage snapshot

19 November 2026. **86 airports, 226 selected lounges, 195 sourced quality assessments, 31 explicitly unrated records.** The second parallel expansion adds 25 airports and 61 lounges to the previous 61-airport / 165-lounge catalog. Airport presence does not mean complete terminal, airline, membership or time-window coverage.

The [expansion plan](EXPANSION.md#second-parallel-expansion--19-november-2026) records completed regional tracks and the next priorities. Regional research notes under [research/](research/) document operational sources, inaccessible pages and omitted access routes. The [quality backlog](research/quality-backlog.json) lists every missing score and why it is absent. An absent score never prevents an otherwise suitable lounge from being shown.

## Delivery size

The entire catalog is **520.3 KiB minified JSON**, or **157.3 KiB** when each airport is gzipped separately. A typical airport guide is **1.7 KiB gzipped**; the largest is **4.1 KiB**. Measurements use UTF-8 `JSON.stringify` and Node `gzipSync`, and are not a promise about HTTP transfer encoding. Clients download individual airports and cache them; the complete catalog and photos are not bundled in the app. External photo links open the publisher’s page.

## Remaining priorities

- Next geographic batch: PKX, SZX and TFU, verifying current mainland-China terminal, operator and local-language sources.
- Deepen existing high-use guides: SFO United/Maple Leaf/Centurion, HNL ANA/central Sakura, SYD non-Qantas options, SIN premium sections, LHR additional airlines and MUC satellite lounges.
- Close principal-airline gaps in starter guides: Saudia at JED/RUH, Aer Lingus at DUB, contracted lounges at CGK/MEX, Falconflyer/Oasis status at BAH/KWI and further KIX airline invitations. Do not imply that an omitted route means the traveller has no real entitlement.
- Recheck temporary operations first: Bahrain Falcon Gold/Pearl, Brussels Loft alternatives, Riyadh terminal changes, Lisbon Tejo amenities and Lima’s late-November domestic maintenance closure.
- Resolve unknown fixed hours and complete the 31 quality assessments using reviews of the exact current facility. Reviews of predecessors or different sections do not supply current operational facts.
- Older installed mobile versions can download these schema-v1 guides. New country/carrier choices are in the shared client code and take effect with the next mobile build; earlier clients retain conservative handling of unknown countries/carriers. No schema, new membership ID or backend change is required.

## Per-airport inventory

“Weekly hours” means a structured weekly schedule is available, not that the lounge is always open or usable. Other records preserve unknown/flight-dependent hours and explanatory notes. Sizes exclude the small shared manifest.

| Airport | Lounges | Rated | Weekly hours | Minified KiB | Gzip KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| ADD | 2 | 1 | 2 | 3.1 | 1.2 |
| AKL | 2 | 2 | 1 | 4.5 | 1.6 |
| AMS | 4 | 4 | 2 | 9.4 | 2.4 |
| ARN | 2 | 1 | 1 | 4.0 | 1.6 |
| ATL | 2 | 2 | 0 | 6.9 | 2.0 |
| AUH | 2 | 2 | 2 | 5.1 | 1.7 |
| BAH | 2 | 2 | 0 | 4.2 | 1.5 |
| BCN | 2 | 1 | 2 | 4.1 | 1.5 |
| BKK | 2 | 2 | 2 | 3.8 | 1.3 |
| BNE | 2 | 1 | 2 | 5.3 | 1.6 |
| BOG | 2 | 2 | 2 | 4.4 | 1.5 |
| BOM | 1 | 0 | 1 | 1.6 | 0.8 |
| BOS | 2 | 2 | 1 | 6.1 | 1.9 |
| BRU | 3 | 3 | 3 | 8.3 | 2.1 |
| CAI | 2 | 2 | 2 | 4.3 | 1.6 |
| CAN | 2 | 1 | 0 | 4.2 | 1.3 |
| CDG | 3 | 3 | 3 | 8.5 | 2.3 |
| CGK | 2 | 2 | 1 | 4.6 | 1.5 |
| CLT | 2 | 2 | 2 | 5.5 | 1.8 |
| CMN | 2 | 1 | 1 | 4.2 | 1.5 |
| CNS | 1 | 1 | 0 | 2.8 | 1.1 |
| CPH | 2 | 2 | 1 | 4.4 | 1.7 |
| CPT | 2 | 1 | 2 | 4.8 | 1.8 |
| DEL | 2 | 1 | 1 | 3.9 | 1.5 |
| DEN | 2 | 2 | 2 | 4.2 | 1.4 |
| DFW | 2 | 2 | 1 | 5.3 | 1.7 |
| DOH | 3 | 3 | 1 | 6.8 | 2.1 |
| DPS | 2 | 2 | 1 | 4.2 | 1.5 |
| DTW | 2 | 2 | 1 | 6.4 | 2.1 |
| DUB | 2 | 2 | 2 | 4.1 | 1.5 |
| DXB | 2 | 2 | 1 | 4.8 | 1.7 |
| EWR | 1 | 1 | 0 | 2.0 | 1.0 |
| FCO | 2 | 1 | 2 | 5.8 | 1.4 |
| FRA | 3 | 2 | 3 | 6.7 | 1.8 |
| GRU | 2 | 1 | 2 | 4.3 | 1.6 |
| HAN | 2 | 1 | 1 | 4.1 | 1.7 |
| HEL | 3 | 3 | 3 | 6.5 | 1.9 |
| HKG | 3 | 3 | 3 | 6.5 | 1.8 |
| HND | 3 | 3 | 1 | 6.8 | 2.1 |
| HNL | 4 | 4 | 3 | 9.3 | 2.7 |
| IAD | 2 | 2 | 2 | 4.7 | 1.8 |
| IAH | 2 | 1 | 0 | 4.5 | 1.6 |
| ICN | 3 | 3 | 3 | 7.4 | 2.2 |
| IST | 3 | 3 | 3 | 6.6 | 1.9 |
| JED | 2 | 1 | 2 | 3.1 | 1.1 |
| JFK | 3 | 3 | 2 | 7.2 | 2.0 |
| JNB | 2 | 2 | 2 | 4.5 | 1.6 |
| KIX | 3 | 3 | 2 | 5.9 | 2.0 |
| KUL | 2 | 2 | 2 | 4.1 | 1.4 |
| KWI | 3 | 2 | 2 | 5.1 | 1.7 |
| LAX | 5 | 5 | 3 | 15.4 | 4.0 |
| LGW | 3 | 3 | 2 | 6.7 | 2.0 |
| LHR | 9 | 9 | 9 | 17.5 | 3.7 |
| LIM | 3 | 2 | 3 | 6.7 | 2.1 |
| LIS | 3 | 3 | 3 | 6.1 | 2.0 |
| MAD | 2 | 2 | 2 | 4.8 | 1.5 |
| MEL | 2 | 1 | 2 | 4.5 | 1.6 |
| MEX | 2 | 1 | 2 | 3.8 | 1.4 |
| MIA | 2 | 2 | 1 | 5.2 | 1.7 |
| MNL | 2 | 2 | 1 | 4.0 | 1.5 |
| MSP | 2 | 2 | 2 | 7.4 | 2.2 |
| MUC | 6 | 6 | 6 | 15.9 | 2.6 |
| NBO | 2 | 2 | 1 | 4.3 | 1.6 |
| NRT | 3 | 2 | 2 | 5.5 | 1.8 |
| ORD | 2 | 2 | 2 | 5.1 | 1.8 |
| OSL | 3 | 2 | 1 | 6.2 | 1.9 |
| PEK | 2 | 1 | 1 | 3.2 | 1.3 |
| PER | 2 | 2 | 1 | 5.0 | 1.6 |
| PTY | 1 | 1 | 1 | 3.1 | 1.2 |
| PVG | 2 | 0 | 1 | 3.0 | 1.2 |
| RUH | 2 | 1 | 2 | 4.0 | 1.4 |
| SCL | 2 | 2 | 1 | 4.6 | 1.6 |
| SEA | 2 | 2 | 1 | 6.2 | 2.0 |
| SFO | 5 | 5 | 5 | 15.3 | 4.1 |
| SGN | 2 | 1 | 1 | 3.9 | 1.6 |
| SIN | 10 | 10 | 10 | 18.9 | 3.8 |
| SJO | 2 | 0 | 2 | 3.5 | 1.3 |
| SJU | 3 | 3 | 3 | 6.9 | 2.2 |
| SLC | 3 | 3 | 1 | 10.6 | 2.2 |
| SYD | 7 | 7 | 5 | 17.4 | 3.8 |
| TPE | 3 | 3 | 3 | 6.1 | 1.6 |
| VIE | 4 | 3 | 4 | 8.7 | 2.3 |
| WAW | 3 | 2 | 3 | 7.5 | 1.9 |
| YVR | 2 | 2 | 1 | 4.6 | 1.5 |
| YYZ | 2 | 2 | 1 | 4.6 | 1.5 |
| ZRH | 3 | 2 | 3 | 5.0 | 1.6 |
