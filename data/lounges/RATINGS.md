# Rephase lounge quality ratings

`qualityRating` is Rephase's editorial assessment of published lounge reviews, on a common five-point scale. It is not a Google/Tripadvisor average, a copied publisher score, a measured service guarantee or a claim that we visited. Half-points express intermediate assessments without spurious precision.

| Score | Meaning |
| --- | --- |
| 5 | Exceptional overall experience: standout food, comfort and service. |
| 4 | Very good: strong food and surroundings, with some practical limitations. |
| 3 | Competent: useful essentials and a comfortable enough stop, with material tradeoffs. |
| 2 | Basic: limited food, facilities or comfort; mainly useful for a short stop. |
| 1 | Poor: serious limitations undermine most reasons to visit. |

Assess the quality of food/drinks, seating and atmosphere, service, upkeep and reported crowding together. Do not award points just because admission is exclusive. A shower's presence affects priority suitability separately; it does not automatically establish excellent quality. These are editorial judgments rather than a mathematical conversion of another site's stars.

## Evidence and updates

Every assessment has a concise `summary`, `reviewedOn` date and its own `sources` with URLs and `checkedOn` dates. The checked date records when we consulted the article, not when the reviewer visited. Read the actual review and identify the terminal, lounge section and refurbishment before assigning a score. Prefer independent firsthand accounts; consider both strengths and weaknesses, and seek corroboration for especially strong claims. Preserve qualifications when evidence is older, limited to an opening event or applies only to a premium section.

The initial November 2026 batch covers all 42 lounges. Most assessments use one detailed review, so they are an editorial starting point rather than a broad consensus. Publishers include Point Hacks, One Mile at a Time, Live and Let's Fly, The MileLion, LoungeReview, Mainly Miles, NerdWallet and independent travel writers. Some publications use affiliate links or hosted visits; their articles disclose this. Keep our summaries short, in our own words, and link the original rather than reproducing reviews or photos.

Specific boundaries in this batch:

- Sydney Qantas Business uses the **temporary Gate 24** review, not the previous lounge or the future renovation.
- Munich Airport Lounge World uses a June 2026 visit to the **new Terminal 1 pier**. Reviews of its old location do not set this rating.
- LAX Virgin Clubhouse uses the **2025 TBIT** section of an article that also contains an older Terminal 2 review.
- LAX Qantas First retains a **historical** rating while marked temporarily closed. Review again after reopening.
- Singapore Terminal 2 KrisFlyer Gold and SilverKris Business assessments describe the reviewed facilities before their ongoing redevelopment. Reassess when replacements open; do not rate an announced improvement as delivered.
- Singapore Plaza Premium T1 and Sydney The House use older visits; their summaries disclose the age/limitations. Published updates are not assumed to be new visits.
- Salt Lake City Delta Concourse B uses an opening visit, which cannot establish ordinary peak-time crowding.
- SFO British Airways rates the general lounge, not the separate first-class dining experience.

Keep quality research separate from operational research. A new rating must not advance the airport's `updatedAt` or an access rule's source date. Reviews cannot silently change eligibility, opening hours or structured amenities; those still need current operator/program evidence. A rating remains an assessment of the documented experience until re-reviewed, not live monitoring.

For a new lounge without credible review evidence, omit `qualityRating` until researched rather than inventing a score. The schema permits that, and unrated lounges sort after rated lounges with equal suitability. The current coverage test checks that our existing guides have completed assessments; update that expectation explicitly if adding unreviewed coverage.

## Ordering

The shared web/native matcher orders results lexicographically:

1. Open, eligible lounges with a usable visit; then open, conditional options with a usable visit; then uncertain/too-short options; then closed or ineligible options.
2. Suitability for the selected priority. Showers/quiet: documented **yes**, then **unknown**, then **no**. Dining: restaurant, buffet, snacks, unknown, no food. Unknown remains visibly unconfirmed, never a claim that an amenity exists.
3. Quality rating, highest first; unrated last.
4. Name, then stable ID, for deterministic ties.

“A little of everything” uses the existing spread-of-amenities weights: showers 10, quiet area 7, spa 3, Wi-Fi 2, plus restaurant 12 / buffet 8 / snacks 3. Only known amenities contribute. For a specific priority, unrelated amenities do not affect suitability. Extra visit duration beyond the useful minimum and `recommendation.bestFor` tags do not outrank quality. `LoungeEvaluation.score` now contains only priority suitability, not a combined quality/access score.

The recommendation is the first eligible, open result with sufficient time. All researched options remain visible with their access/opening state. Both clients display a compact “Rephase rating” and put the explanation and review links in expandable details.
