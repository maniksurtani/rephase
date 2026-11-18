# Lounge coverage snapshot

18 November 2026. **61 airports, 165 selected lounges, 147 sourced quality assessments, 18 explicitly unrated records.** The parallel expansion adds 47 airports and 106 lounges to the previous 14-airport / 59-lounge catalog. Airport presence does not mean complete terminal, airline, membership or time-window coverage.

The [expansion plan](EXPANSION.md) defines the working hub list and follow-on priorities. Regional research notes under [research/](research/) document operational sources, inaccessible pages and omitted access routes. The [quality backlog](research/quality-backlog.json) lists every missing score and why it is absent. An absent score never prevents an otherwise suitable lounge from being shown.

## Delivery size

The entire catalog is **382.2 KiB minified JSON**, or **112.6 KiB** when each airport is gzipped separately. A typical airport guide is **1.6 KiB gzipped**; the largest is **4.1 KiB**. These are reproducible JSON/gzip measurements, not a promise about HTTP transfer encoding. The app downloads individual airports on demand and caches them; the complete catalog and photos are not bundled in the app. External photo links open the publisher’s page.

## Remaining priorities

- Complete the main-airline/terminal gaps at existing hubs: SFO United/Maple Leaf/Centurion, HNL ANA/central Sakura, SYD non-Qantas options, SIN premium sections, LHR additional airlines and MUC satellite lounges.
- Improve starter guides before describing them as comprehensive: CGK currently has a verified ANA-contract route only; MEX has independent membership options while airline-specific access remains a follow-up. Add independent alternatives where absent and where participation can actually be verified.
- Resolve unknown fixed hours from primary sources, particularly KLM Crown, Qatar, mainland China and most newly added US Centurions. Unknown opening times remain visibly conditional; a quality review is not a current operational source.
- Complete the 18 quality assessments using reviews of the exact current facility. Do not transfer predecessor or different-terminal ratings.
- Extend the hub list with the additional regional gateways in EXPANSION.md; this initial 61-airport list is not an exhaustive definition of “tier 1”.

## Per-airport inventory

“Weekly hours” means a structured weekly schedule is available, not that the lounge is always open or usable. Other records preserve unknown/flight-dependent hours and explanatory notes. Sizes exclude the small shared manifest.

| Airport | Lounges | Rated | Weekly hours | Minified KiB | Gzip KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| ADD | 2 | 1 | 2 | 3.1 | 1.2 |
| AKL | 2 | 2 | 1 | 4.5 | 1.6 |
| AMS | 4 | 4 | 2 | 9.4 | 2.4 |
| ATL | 2 | 2 | 0 | 6.9 | 2.0 |
| AUH | 2 | 2 | 2 | 5.1 | 1.7 |
| BCN | 2 | 1 | 2 | 4.1 | 1.5 |
| BKK | 2 | 2 | 2 | 3.8 | 1.3 |
| BNE | 2 | 1 | 2 | 5.3 | 1.6 |
| BOG | 2 | 2 | 2 | 4.4 | 1.6 |
| BOM | 1 | 0 | 1 | 1.6 | 0.8 |
| CAI | 2 | 2 | 2 | 4.3 | 1.6 |
| CAN | 2 | 1 | 0 | 4.2 | 1.3 |
| CDG | 3 | 3 | 3 | 8.5 | 2.3 |
| CGK | 2 | 2 | 1 | 4.6 | 1.5 |
| CMN | 2 | 1 | 1 | 4.2 | 1.5 |
| CNS | 1 | 1 | 0 | 2.8 | 1.1 |
| CPH | 2 | 2 | 1 | 4.4 | 1.7 |
| DEL | 2 | 1 | 1 | 3.9 | 1.5 |
| DEN | 2 | 2 | 2 | 4.2 | 1.4 |
| DFW | 2 | 2 | 1 | 5.3 | 1.7 |
| DOH | 3 | 3 | 1 | 6.8 | 2.1 |
| DXB | 2 | 2 | 1 | 4.8 | 1.7 |
| EWR | 1 | 1 | 0 | 2.0 | 1.0 |
| FCO | 2 | 1 | 2 | 5.8 | 1.4 |
| FRA | 3 | 2 | 3 | 6.7 | 1.8 |
| GRU | 2 | 1 | 2 | 4.3 | 1.6 |
| HEL | 3 | 3 | 3 | 6.5 | 1.9 |
| HKG | 3 | 3 | 3 | 6.5 | 1.8 |
| HND | 3 | 3 | 1 | 6.8 | 2.1 |
| HNL | 4 | 4 | 3 | 9.3 | 2.8 |
| IAH | 2 | 1 | 0 | 4.5 | 1.6 |
| ICN | 3 | 3 | 3 | 7.4 | 2.2 |
| IST | 3 | 3 | 3 | 6.6 | 1.9 |
| JFK | 3 | 3 | 2 | 7.2 | 2.0 |
| JNB | 2 | 2 | 2 | 4.5 | 1.6 |
| KUL | 2 | 2 | 2 | 4.1 | 1.4 |
| LAX | 5 | 5 | 3 | 15.4 | 4.0 |
| LHR | 9 | 9 | 9 | 17.5 | 3.8 |
| MAD | 2 | 2 | 2 | 4.8 | 1.5 |
| MEL | 2 | 1 | 2 | 4.5 | 1.6 |
| MEX | 2 | 1 | 2 | 3.8 | 1.4 |
| MIA | 2 | 2 | 1 | 5.2 | 1.7 |
| MNL | 2 | 2 | 1 | 4.0 | 1.5 |
| MUC | 6 | 6 | 6 | 15.9 | 2.6 |
| NBO | 2 | 2 | 1 | 4.3 | 1.6 |
| NRT | 3 | 2 | 2 | 5.5 | 1.8 |
| ORD | 2 | 2 | 2 | 5.1 | 1.8 |
| PEK | 2 | 1 | 1 | 3.2 | 1.3 |
| PER | 2 | 2 | 1 | 5.0 | 1.6 |
| PTY | 1 | 1 | 1 | 3.1 | 1.2 |
| PVG | 2 | 0 | 1 | 3.0 | 1.3 |
| SCL | 2 | 2 | 1 | 4.6 | 1.6 |
| SEA | 2 | 2 | 1 | 6.2 | 2.0 |
| SFO | 5 | 5 | 5 | 15.3 | 4.1 |
| SIN | 10 | 10 | 10 | 18.9 | 3.8 |
| SLC | 3 | 3 | 1 | 10.6 | 2.2 |
| SYD | 7 | 7 | 5 | 17.4 | 3.9 |
| TPE | 3 | 3 | 3 | 6.1 | 1.7 |
| YVR | 2 | 2 | 1 | 4.6 | 1.5 |
| YYZ | 2 | 2 | 1 | 4.6 | 1.6 |
| ZRH | 3 | 2 | 3 | 5.0 | 1.6 |
