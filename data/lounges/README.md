# Lounge research data

Edit one JSON file per airport: `SYD.json`, `HNL.json`, `SFO.json` and `LAX.json`. The app reads these files at build time; browsing and matching do not need a lounge API or server. `schema.json` is the editor/CI contract, and `src/lib/lounge-types.ts` defines the matching types.

## Research and editing workflow

1. Start from the airline, lounge operator, airport or membership program's official page. Check both the lounge location page and the access-policy page. Search results and older reviews are leads, not confirmation.
2. Record each source's exact URL and the date you opened it in `sources`. Use a short stable source ID and cite it from the relevant `accessRules[].sourceIds`. `updatedAt` is the airport file's review date, not the lounge's opening date.
3. Update location, operating status, opening hours and amenities. Missing information is `unknown`; an omitted shower or spa in a facilities list does not prove it is unavailable. Use `no` only with explicit evidence. `dining: "none"` means no food; a drinks-only lounge should not earn a meal recommendation.
4. Add or revise access rules. Rules are alternatives (OR); all populated fields within a rule must hold (AND). Membership, operating carrier, marketing carrier, route, cabin and entry-window constraints are separate facts. Keep any unencoded restriction in `conditions`: it makes that rule conditional. `note` explains facts such as fees; it does not enforce a restriction.
5. Add photos only when you have permission or a suitable license, then run the repository's type, data and lounge tests. Check the app with at least one eligible case, a conditional case, a closed visit and an unsupported program.

Keep a lounge's `id` stable when its name, hours or location change. Use a new ID for a genuinely different lounge. A temporary closure belongs in `status`; do not delete the historical record merely to hide it.

## Access conditions and incomplete coverage

An eligible cabin does not automatically grant access to every lounge. The actual operating airline, marketing airline, route, fare and membership issuer can matter. A flight-number prefix is a marketing hint, not proof of the operating carrier. US domestic First and international Business must not be treated as equivalent.

Use explicit airline/status rules where they are verified. Generic oneworld Sapphire/Emerald records remain conditional when the issuing program is unknown: Atmos and AAdvantage have North America exceptions. Paid Qantas Club, Admirals Club and Alaska memberships are separate from alliance status. Do not convert a Qantas Club membership into oneworld Sapphire.

`conditions` is for a restriction the engine cannot resolve, such as a fare that excludes lounge access or a separate guest policy. Write a concise action, such as “Confirm this fare includes lounge access.” Avoid marking an access rule eligible while hiding a material prerequisite in its informational `note`.

Entry and visit limits differ. `maxMinutesBeforeDeparture` controls how early a traveler may enter; `maxVisitMinutes` caps the stay. Record both when the operator specifies both. Guest limits and charges depend on program and card issuer; these seed files match one traveler, not an entire party or a promise of free entry. Capacity can still affect admission.

## Hours

All wall-clock hours use the airport file's IANA `timeZone`. Weekday numbers follow ISO: Monday 1 through Sunday 7. An overnight period belongs to its opening day:

```json
{
  "type": "weekly",
  "periods": [
    { "days": [1, 2, 3, 4, 5, 6, 7], "open": "22:00", "close": "02:00" }
  ],
  "exceptions": [
    { "date": "2026-12-25", "periods": [], "note": "Closed for the holiday." }
  ]
}
```

Use `flight-dependent` when the operator publishes a rule based on its daily flights. Put that rule in `hours.note`; never turn a guessed flight schedule into fixed opening hours. Use `unknown` if no usable current hours are published. When two official sources disagree, state the disagreement and prefer a conservative or unknown result.

## Amenities, fees and recommendations

Distinguish a full-service restaurant from a buffet, snacks or no food. A confirmed shower can still cost extra or require a booking: put that detail beside the access rule and in the lounge note. A spa's existence does not establish that every eligible visitor may use it.

The app's recommendation compares access, usable opening time and the traveler's selected amenity priority. Do not fabricate star ratings, popularity or a “best lounge” rank. Offline research can improve the verified facts and add an optional editorial `recommendation`:

```json
{
  "recommendation": {
    "summary": "A useful choice for a shower and restaurant meal before an international flight, when your ticket or status gives access.",
    "bestFor": ["showers", "dining"]
  }
}
```

This example fits Sydney Qantas First because the official facilities page confirms showers and restaurant dining. `summary` is a short research-based explanation; optional `bestFor` values are `balanced`, `showers`, `dining` and `quiet`. Support each selection with the lounge's verified amenities and sources. An unverified quiet area should not earn a quiet recommendation. The editorial preference is a gentle ranking tie-breaker after access and opening checks; it cannot make an ineligible or closed lounge accessible. Use `note` for other practical details, such as upgrade fees or incomplete coverage. Research that introduces a new access condition or scoring input should extend the types/schema and tests before relying on that field.

## Photos

Store optimized, owner-supplied or explicitly licensed images in `public/lounges/<lounge-id>/`. Prefer WebP or AVIF, around 1,200 px wide or smaller, with descriptive filenames. Use paths beginning `/lounges/` in the JSON:

```json
{
  "path": "/lounges/syd-qantas-first/dining-room.webp",
  "alt": "Dining tables beside the Sydney First Lounge windows",
  "credit": "Photographer name",
  "license": "CC BY 4.0; cropped and resized",
  "sourceUrl": "https://example.org/original-photo-and-license"
}
```

Keep the permission/license evidence with your research. If permission was granted privately, preserve it outside the public repository and use an appropriate public source/credit reference. Do not publish private correspondence, faces without suitable permission, credentials or boarding passes. Do not copy airline marketing images or hotlink them merely because an official page displays them. `photos: []` is valid and uses the app's fallback presentation.

## Initial research: 15 October 2026

SYD covers Qantas First, the temporary Qantas International Business space, The House and Plaza Premium International Departures. HNL covers Qantas International Business, IASS Hawaii and Premier Club. These are selected starter records, not complete airport inventories.

Current findings that differ from older lounge guides:

- Sydney's Qantas Business lounge is operating in a temporary Level 2 space. The official current facilities list does not confirm showers; historical lounge amenities are not reused.
- The House charges Priority Pass visitors an additional AUD20 for showers, à la carte dining and premium alcohol. Plaza Premium departure showers also cost extra.
- Honolulu's Qantas lounge has weekday-dependent morning hours and closes around midday. IASS has no food. Premier Club's detailed Priority Pass hours open later on weekends than its headline listing.
- The current Priority Pass Honolulu directory lists Premier Club and IASS, not Plumeria. Hawaiian Premier Clubs are explicitly excluded from reciprocal oneworld access.
- Qantas international Jetstar JQ access changed in July 2026. Codeshares, Emirates, special fares, long-haul connecting-ticket access and guests require additional rules; they are not silently assumed.

Useful follow-up coverage includes Sydney domestic lounges, Air New Zealand's Sydney lounge and Honolulu's JAL Sakura Lounge Hale. The latter publishes flight-dependent hours, and Air New Zealand's current Sydney facilities page does not publish fixed hours. Keep missing coverage visible rather than treating these omissions as evidence that access is impossible.


## LAX review: 16 October 2026

The existing `lax-qantas-business` record is displayed as **Qantas / oneworld Business Lounge** so travelers can recognize the Qantas-operated lounge. Its [official Qantas location page](https://www.qantas.com/en-au/at-the-airport/lounges/locations/los-angeles-international-business) calls it “The Los Angeles Business Lounge” and confirms Level 5, daily 06:30–midnight, showers, lounge dining and Wi-Fi. This is a rename, not a second lounge. [Qantas still marks the First Lounge temporarily closed](https://www.qantas.com/en-au/at-the-airport/lounges/locations/los-angeles-first), and its [access page](https://www.qantas.com/en-au/at-the-airport/lounges/access) directs eligible First Lounge travelers to Business while it is closed.

United Premier Gold, Platinum and 1K now have an explicit international-departure rule for the LAX Star Alliance Lounge. The reviewed [ANA eligibility page](https://www.ana.co.jp/en/us/travel-information/lounges/los-angeles/) supports Star Alliance Gold access on international Star Alliance departures, while warning that domestic-transfer criteria may differ. The existing generic Star Alliance Gold rule leaves domestic United access conditional pending a directly verified applicable policy; the app does not interpret an international-only researched rule as a worldwide denial. This lounge is distinct from United Club and Polaris lounges. Its opening hours remain unverified. Source review dates changed only for pages opened during this review.

Airport files named with three uppercase IATA letters (for example `SFO.json`) are discovered automatically by the app and the same schema/semantic tests. No import list needs updating.
