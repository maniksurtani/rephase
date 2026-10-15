# Offline lounge research prompt

Give your research assistant this prompt together with `schema.json` and the airport's current JSON file. Review its output before committing.

> Update this Rephase airport lounge JSON using current official airline, airport, lounge-operator and membership-program sources. Return JSON conforming exactly to the supplied schema, plus a short list of unresolved questions. Preserve stable IDs and existing fields unless there is evidence to change them.
>
> For each lounge, verify physical location/terminal and airside access, closures, local opening hours, showers, dining service type, spa, quiet areas and Wi-Fi. Record source URLs and the actual date checked. Missing information is unknown. Do not copy opening hours from search snippets or historic reviews. Distinguish fixed hours, flight-dependent rules and date-specific exceptions.
>
> Encode access alternatives as OR rules; within each rule, membership, marketing carrier, operating carrier, cabin, route and time restrictions are AND. Check fare/upgrade exceptions, status issuer, domestic/international restrictions, qualifying connections, entry-before-departure limits and maximum stays. Any material restriction not represented by a structured field belongs in conditions, which makes access conditional. Do not hide prerequisites in note. Cite each rule with sourceIds.
>
> Include mandatory extra entry fees in additionalFee and explain charges in note. Keep paid showers, dining upgrades, spa reservations, membership visit charges and guest fees separate; missing fee metadata does not mean free admission. Do not infer alliance rights from a credit-card or lounge membership. Do not equate US domestic First with international premium access.
>
> Add a concise recommendation.summary describing useful strengths and tradeoffs supported by the research, and optional bestFor tags (balanced, showers, dining, quiet). Avoid invented scores, personal visit claims or unsupported claims about noise, crowding and quality. Access and opening checks take precedence over editorial preferences.
>
> Leave photos empty unless an owner-supplied or explicitly licensed local image is available. For each permitted image provide path, alt, credit, license and sourceUrl; do not copy airline marketing images merely because they are public. Do not include personal details, credentials or boarding passes.

After editing, run:

```sh
npx vitest run tests/lounge-data.test.ts tests/lounge-access.test.ts tests/lounge-windows.test.ts tests/lounge-preferences.test.ts
npm run typecheck
npm run build
```

For another airport, add its JSON import to `src/lib/lounge-data.ts` and register it in `tests/lounge-data.test.ts`. Extend the explicit airport-country map in `src/lib/lounge-windows.ts` when known, so route buffers and country checks can be resolved. Otherwise the engine keeps unknown routes conservative. New membership IDs or scoring inputs require coordinated type/schema/validation/UI and test changes. Photo files must exist under `public/lounges/<lounge-id>/` before data checks pass.
