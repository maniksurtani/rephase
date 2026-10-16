# Loyalty program catalog

Reviewed against official airline and alliance sources on **16 October 2026**. The implementation is [`src/lib/lounge-programs.ts`](../../src/lib/lounge-programs.ts). The catalog contains 13 programs; it is a curated starting set, rather than a complete airline directory.

Settings lets a user search for a program, add it, and select their current tier. The first option is always the entry-level membership and carries no alliance status. Paid lounge memberships remain a separate section. Membership numbers are not collected.

## Published tiers and alliance recognition

The order below is entry level to highest published tier included. “Member” denotes ordinary membership without elite status. Alliance recognition does not itself establish access to every lounge: operating airline, ticket, destination, opening hours and program-specific exclusions still apply.

| Program | Selectable tiers | Published alliance mapping | Primary sources |
| --- | --- | --- | --- |
| Qantas Frequent Flyer | Bronze; Silver; Gold; Platinum; Platinum One | Silver → oneworld Ruby; Gold → Sapphire; Platinum and Platinum One → Emerald | [oneworld Qantas](https://www.oneworld.com/members/qantas); [Qantas Bronze](https://www.qantas.com/au/en/frequent-flyer/status-and-clubs/status/bronze.html) |
| United MileagePlus | Member; Premier Silver; Premier Gold; Premier Platinum; Premier 1K | Premier Silver → Star Alliance Silver; Gold, Platinum and 1K → Star Alliance Gold | [United Premier status benefits](https://www.united.com/en/us/fly/mileageplus/premier/benefits.html) |
| American AAdvantage | Member; Gold; Platinum; Platinum Pro; Executive Platinum | Gold → oneworld Ruby; Platinum → Sapphire; Platinum Pro and Executive Platinum → Emerald | [oneworld American Airlines](https://www.oneworld.com/members/american-airlines); [American member statuses](https://www.aa.com/web/i18n/aadvantage-program/discover/member-statuses.html) |
| Atmos Rewards | Member; Silver; Gold; Platinum; Titanium | Silver → oneworld Ruby; Gold → Sapphire; Platinum and Titanium → Emerald | [oneworld Alaska Airlines](https://www.oneworld.com/members/alaska-airlines) |
| Delta SkyMiles | Member; Silver Medallion; Gold Medallion; Platinum Medallion; Diamond Medallion | Silver → SkyTeam Elite; Gold, Platinum and Diamond → Elite Plus | [Delta Medallion benefits](https://www.delta.com/us/en/skymiles/medallion-program/medallion-benefits); [Delta international partner benefits](https://www.delta.com/us/en/skymiles/medallion-program/international-partner-skyteam-benefits) |
| The British Airways Club | Blue; Bronze; Silver; Gold | Bronze → oneworld Ruby; Silver → Sapphire; Gold → Emerald | [British Airways tiers](https://www.britishairways.com/content/the-british-airways-club/about-the-club/tiers-and-benefits); [oneworld British Airways](https://www.oneworld.com/members/british-airways) |
| Cathay | Green; Silver; Gold; Diamond | Silver → oneworld Ruby; Gold → Sapphire; Diamond → Emerald | [oneworld Cathay Pacific](https://www.oneworld.com/members/cathay-pacific); [Cathay membership](https://www.cathaypacific.com/cx/en_US/membership.html) |
| Air Canada Aeroplan | Member; 25K; 35K; 50K; 75K; Super Elite | 25K and 35K → Star Alliance Silver; 50K, 75K and Super Elite → Gold | [Aeroplan Elite Status tiers](https://www.aircanada.com/ca/en/aco/home/aeroplan/status/tiers.html) |
| Singapore Airlines KrisFlyer | Member; Elite Silver; Elite Gold | Elite Silver → Star Alliance Silver; Elite Gold → Gold | [KrisFlyer privileges](https://www.singaporeair.com/en_UK/sg/ppsclub-krisflyer/krisflyer/krisflyer-privileges/); [Elite Gold](https://www.singaporeair.com/en_UK/sg/ppsclub-krisflyer/krisflyer/krisflyer-elite-gold/) |
| Emirates Skywards | Blue; Silver; Gold; Platinum | No alliance tier inferred | [Emirates membership tiers](https://www.emirates.com/english/skywards/membership-tiers/) |
| Velocity Frequent Flyer | Red; Silver; Gold; Platinum; Platinum Plus | No alliance tier inferred | [Velocity status levels](https://www.velocityfrequentflyer.com/the-basics/status) |
| Air New Zealand Koru | Bronze; Silver; Gold; Platinum; Black | Silver → Star Alliance Silver; Gold, Platinum and Black → Gold | [Koru overview](https://www.airnewzealand.com/en-nz/koru); [Silver](https://www.airnewzealand.com/en-nz/koru/tiers/koru-silver); [Gold](https://www.airnewzealand.com/en-nz/koru/tiers/koru-gold); [Platinum](https://www.airnewzealand.com/en-nz/koru/tiers/koru-platinum); [Black](https://www.airnewzealand.com/en-nz/koru/tiers/koru-black) |
| Miles & More | Member; Frequent Traveller; Senator; HON Circle Member | Frequent Traveller → Star Alliance Silver; Senator and HON Circle → Gold | [Status levels](https://www.miles-and-more.com/row/en/program/status-benefits/status-levels.html); [Frequent Traveller](https://www.miles-and-more.com/row/en/program/status-benefits/frequent-traveller-status.html); [HON Circle](https://www.miles-and-more.com/row/en/program/status-benefits/hon-circle-status.html) |

### Research findings that affect the data

- **United 1K is supported directly.** The rendered United benefits page states: “Premier Silver members are eligible for Star Silver status; Premier Gold, Premier Platinum, and Premier 1K members are eligible for Star Gold.” United Club is a separate paid membership; selecting Premier 1K never adds it. Raw HTTP retrieved only a JavaScript shell, so the page was rendered in Chromium for verification. Global Services appears in United's bonus-mile table, but its alliance mapping was not explicitly verified in this review; it is omitted for now.
- **Alaska and Hawaiian use Atmos Rewards.** The current oneworld Alaska member page lists Silver, Gold, Platinum and Titanium. Search aliases include Alaska, Hawaiian, Mileage Plan, HawaiianMiles and MVP; these aliases do not create retired status tiers or infer a conversion.
- **Air New Zealand's current program is Koru.** The former `/airpoints` page redirects to the official Koru overview. It lists Bronze, Silver, Gold, Platinum and Black. Each elite tier's own page explicitly publishes its Star Alliance recognition. “Airpoints” and “Elite” remain search aliases so people can find the program using familiar names. Paid lounge subscriptions must be represented separately if added later.
- **Velocity's current top tier is Platinum Plus.** The official status page explicitly lists Red, Silver, Gold, Platinum and Platinum Plus. Lifetime qualification, invitations and benefit variations do not automatically create separate access capabilities here.
- **Qantas IDs already saved by Rephase remain unchanged:** `qantas-gold`, `qantas-platinum`, `qantas-platinum-one`. Qantas's own pages returned HTTP 503 during this review; the accessible official oneworld Qantas page verified the elite names and alliance mappings. The Bronze entry is ordinary membership and grants no lounge status.
- **No access follows from a familiar-sounding tier name.** Qantas Silver and Aeroplan 35K, for example, are not promoted to lounge-eligible alliance levels. Emirates and Velocity tiers have no blanket alliance equivalent. Delta elite status is not converted into a paid Sky Club membership. Carrier-specific domestic and route exceptions remain the responsibility of each lounge's access rules.

## Storage and adding programs

The preferences model continues to store stable flat IDs, for example:

```json
{
  "loungeMemberships": ["priority-pass", "qantas-platinum", "united-premier-1k"]
}
```

A program's tiers are ordered from entry level upward. The UI replaces that program's old selection when a new tier is picked, allows removal, and avoids duplicate program rows. Existing saved paid memberships and generic alliance-tier entries stay readable. Generic alliance entries can remain a fallback for a program not yet in the catalog; they cannot identify an issuing airline and therefore cannot resolve issuer-specific exceptions.

To extend the curated list:

1. Verify the current program name, all selectable tier names and any alliance mappings on official airline or alliance pages. Record URLs and the review date in `sources`.
2. Add one program object to `LOYALTY_PROGRAMS`, with a stable program ID, a base membership that grants no alliance status, tiers in ascending order, and useful current/previous-name search aliases. Keep persisted tier IDs stable after release.
3. Align the lounge JSON schema membership enum with the shared catalog-derived validation. Do not accept arbitrary user-supplied IDs.
4. Add a focused test when the program introduces a meaningful mapping boundary or naming/search ambiguity. Change a lounge's access rules only when its specific policy has also been researched.

The catalog is static, works offline, and requires no new service or API key. Reviews should revisit linked primary sources when programs rename tiers or lounge access policies change.
