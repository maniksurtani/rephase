# Oceania and Latin America hub starter guides

Researched **18 November 2026** (Australia/Brisbane). Added nine airport files and 17 lounges. These are practical starter guides, not complete inventories of every terminal, airline invitation, bank card or elite program. Each lounge stores its operational sources, checked date, external photo links and, when supported by a firsthand review, an editorial quality assessment.

| Airport | Included | Important remaining gaps |
| --- | --- | --- |
| MEL | Qantas International; Aspire T2 | Qantas First, domestic Business/Club, Virgin Australia, other international carriers and Marhaba |
| BNE | Qantas International; Escape International | Domestic Business/Club/Virgin; Singapore Airlines and Emirates; verify completion of Qantas entrance works |
| PER | Qantas T3 International; Aspire T1 International | Qantas domestic Business/Club; domestic T2 Aspire; Emirates/Singapore Airlines; more specific Qantas flight restrictions |
| AKL | Air New Zealand International Koru; Strata | Temporary invitation-only Lookout as a separate record; domestic Koru; Qantas; broaden native Koru and partner eligibility |
| MEX | Grand Lounge Elite T1; Harmony T2 | Aeromexico Salones Premier, Admirals Club and Amex. Aeromexico's operator page did not expose a usable current policy; no outdated domestic Business assumption was added |
| GRU | LATAM T3; W Premium The Pier T3 | Domestic T1/T2, Admirals Club, bank-card lounges; LATAM Pass tiers and bilateral partner exceptions |
| PTY | Copa Club T2 | Copa Club T1, The Lounge T1/T2, native ConnectMiles status; individual guest entitlements |
| BOG | LATAM International; El Dorado International | Avianca main/Diamond lounges, Copa and domestic lounges; native LATAM Pass/Lifemiles tiers |
| SCL | LATAM Signature; SkyTeam | LATAM Premium and Santander WorldMember are distinct access tiers, not interchangeable with Signature; domestic Pacific Club; native LATAM Pass |

## Method and reusable evidence

Operational facts come from opened official airline/operator/airport/program pages. Some JavaScript sites expose more detail in the publicly delivered page data than in a reader's text extract:

- LATAM's public Santiago, São Paulo and Bogotá pages were opened, then their same-origin `.model.json` page content was read to obtain the complete current location, operating hours, facilities and access terms. These endpoints are the page's own public rendering data, not a private API. Human-facing URLs remain the sources in the catalog:
  - [Santiago](https://www.latamairlines.com/us/en/experience/airport/lounges-and-facilities/santiago), [page data](https://www.latamairlines.com/us/en/experience/airport/lounges-and-facilities/santiago.model.json).
  - [São Paulo](https://www.latamairlines.com/us/en/experience/airport/lounges-and-facilities/sao-paulo), [page data](https://www.latamairlines.com/us/en/experience/airport/lounges-and-facilities/sao-paulo.model.json).
  - [Bogotá, Spanish](https://www.latamairlines.com/co/es/experiencia/aeropuerto/lounges-y-salones/lounge-bogota), [page data](https://www.latamairlines.com/co/es/experiencia/aeropuerto/lounges-y-salones/lounge-bogota.model.json).
- Copa's [locations](https://www.copaair.com/en-EC/discover-copa-airlines/airport-experience/copaclub/) and [access rules](https://www.copaair.com/en-gs/discover-copa-airlines/airport-experience/copa-club-rules/) were read from their public HTML `__NEXT_DATA__` payload. This gives current locations, five-hour Priority Pass admission window and the explicit shower restrictions.
- Priority Pass pages were opened and their publicly delivered facility data inspected where the reader extract showed only the first few facilities. Positive facilities were used; false/default fields were not treated as reliable evidence that a feature is absent. This confirmed showers/Wi-Fi at The Pier, showers/spa/Wi-Fi and extra charges at El Dorado, showers/quiet area/Wi-Fi at SkyTeam SCL, and quiet area/Wi-Fi at Harmony MEX.
- Unverified facilities remain `unknown`. A generic description of dining does not establish a restaurant or buffet. The existence of showers does not promise a free shower or a slot on arrival.
- Editorial ratings summarize firsthand observations, not an average of ratings from directories. Older reviews are identified as such. Fees, hours and access never come from an old review where a current primary source is available.
- `photoLinks` open external review or official photo pages. No image files, hotlinks or third-party image licensing assumptions were added.

## Access distinctions and limitations

### Australia and New Zealand

The three Qantas records are **international lounges**, not domestic Business lounges or Qantas Clubs. General oneworld status/cabin rules require both a oneworld-operated and a oneworld-marketed flight. They do not extend domestic Business access to Sapphire. The [current Qantas access policy](https://www.qantas.com/en-au/at-the-airport/lounges/access) excludes Flexible Qantas Club from the standard international membership entitlement. It also changes international Jetstar access from 1 July 2026; no broad Jetstar or Emirates assumptions were added.

Brisbane's [current Qantas location page](https://www.qantas.com/en-au/at-the-airport/lounges/locations/brisbane-international) describes an airside lounge. [April 2026 reporting](https://www.pointhacks.com.au/news/qantas-brisbane-lounge-landside-cut-jetstar-access/) describes a temporary landside entrance during terminal works. We could not verify an end date. The record follows the current official airside classification but adds a material condition to every access path requiring confirmation of the current entrance and allowance for security. The earlier three-level lounge review is not evidence that the temporary approach is unchanged.

Melbourne's current Priority Pass Aspire listing retains a legacy `mel11l-the-house` URL, and its embedded descriptive prose includes older hours/location text alongside current structured Gate 8 / Level 1 data. The catalog follows the current displayed location and hours, explicitly calls out legacy text, and does **not** transfer the old The House review/rating to this listing. Its current facility data identifies showers and buffet; legacy premium-offering text describes a separate AUD 20 upgrade, so guests are told to confirm the current inclusions. This is not a mandatory entry surcharge.

Perth's Qantas lounge is in **T3** and opens three hours before its international departures. Aspire is in **T1 International**. These are not convenient interchangeable lounges. Aspire's operator explicitly charges program-card visitors AUD 20 for the optional shower service.

Air New Zealand's [current official page](https://www.airnewzealand.com/en-nz/koru/tier-benefits/koru-lounges/international-lounges) confirms staged AKL refurbishment through the end of 2027. Eligible passengers may receive an alternative lounge allocation. The main lounge has buffet/showers, but fixed current hours were not published, so they are `unknown`. The rating is explicitly a pre-refurbishment 2022 assessment. The temporary Lookout has no internal bathrooms, is open 05:00–10:00 and 15:30–21:15, and requires a check-in invitation; its facilities must not be inferred from the main lounge. Strata is a separate independent alternative with operator-confirmed complimentary showers.

### Latin America

**LATAM is not a oneworld member.** The new LATAM rules use explicitly published cabin and named partner benefits. Generic alliance status is not enough. LATAM Business/Premium Economy applies to the departing international segment; a past premium connection does not make an onward economy segment eligible. Delta One is separately conditional because a generic business/First cabin field does not establish Delta One. Specific LATAM Pass and bank-card entitlements are left for future program support.

At Santiago, **Signature**, **Premium** and **WorldMember** are separate products. Premium Economy and Delta Gold are not granted Signature access. Signature closes at midnight in standard time or 01:00 in daylight saving time. With no seasonal rule in the schema, its hours are explicitly `unknown` with the real schedule explained; it is not asserted to be open 24 hours.

Priority Pass [SkyTeam Santiago](https://www.prioritypass.com/en-GB/lounges/chile/arturo-merino-benitez-international/scl8-skyteam-lounge) restricts access to SkyTeam flights or SkyTeam codeshares. The two OR rules encode operated **or** marketed SkyTeam membership. An unrelated LATAM flight and Priority Pass alone do not qualify. Generic SkyTeam status invitations are not added without a separately checked access policy.

Copa Club T2 currently has 05:30–22:15 hours on both the operator and Priority Pass pages. Priority Pass entry is up to five hours before departure with a five-hour stay. Showers are restricted to qualifying itineraries with flights over 4.5 hours or qualifying ConnectMiles Platinum/Presidential status, and twenty-minute sessions; a generic shower amenity does not override that restriction. Native ConnectMiles status is not yet in the settings enum. Current PP/operator guest wording differs, so the guide makes no blanket unlimited-guest promise.

BOG's current LATAM page does not confirm Priority Pass despite a 2024 review describing that access route; it was deliberately omitted. Current El Dorado PP terms make buffet/showers/spa paid extras. Those optional charges are not stored as mandatory entry fees. Avianca's [official help article](https://ayuda.avianca.com/hc/en-us/articles/37716644900635-How-to-access-avianca-VIP-Lounges-when-flying-in-Business-Class-or-holding-a-Lifemiles-Elite-status) confirms Diamond is a separate product: no blanket Star Gold-to-Diamond mapping should be added. Further location/facilities verification is needed before adding it.

The GRU airport directory has a generic W Premium T3 record near gates 323/324. Priority Pass's **The Pier** record instead describes the end of the pier. Reviews and images for **5th Avenue** must not be silently reused for The Pier; an independent directory's supposed The Pier review link led to a 5th Avenue article. The guide therefore uses The Pier's own PP record and leaves it unrated.

MEX Harmony and Grand Lounge Elite are separately identified by terminal. Their PP pages list both domestic and international departures, but an airside lounge listing does not establish an easy transfer between T1 and T2. Aeromexico access changes need a fresh operator-policy check before inclusion.

## Editorial rating backlog

These four records intentionally have no `qualityRating`:

| Lounge ID | Reason |
| --- | --- |
| `mel-aspire-t2` | Legacy The House review location differs from current Aspire listing; need a verified current-location review |
| `bne-escape-international` | Current operator and PP facts verified; no sufficiently clear independent firsthand review found during this batch |
| `mex-harmony-t2` | Current PP location/facilities/access verified; no sufficiently clear independent firsthand review found |
| `gru-w-premium-the-pier` | Review links confused The Pier with 5th Avenue; need an unambiguous firsthand account of The Pier |

Historical ratings needing follow-up first: AKL Air New Zealand (2022 before the rebuild), BNE Qantas (before entrance works), and MEL Qantas (2025). Reviews are external links, not evidence of a present-day site visit by Rephase.

## Validation and next pass

All nine JSON documents pass the shared draft-07 schema using Ajv. All access-rule source IDs resolve within their lounge record. No shared schema, app code, generated assets or tests were changed in this batch.

Next expansion should prioritize domestic connecting coverage at MEL/BNE/PER, main-carrier Aeromexico/Avianca coverage at MEX/BOG, the additional SCL LATAM access tiers, native LATAM Pass/ConnectMiles/Lifemiles settings, and resolving the four unrated records before widening minor terminal coverage.
