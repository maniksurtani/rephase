# Continuous journey — three UI concepts

Interactive design study for Rephase, 7 November 2026. Open [index.html](index.html) in a browser. No build, sign-in or network access is needed. The repository's local fonts are optional; system fonts are the fallback.

On a Mac, from the repository root:

```sh
open docs/prototypes/continuous-timeline/index.html
```

Or serve the repository with `python3 -m http.server 5180` and open <http://localhost:5180/docs/prototypes/continuous-timeline/>.

| Concept               | Emphasis                                                         | Tradeoff                                                                          |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **A · Flow**          | Compact, expandable guidance on one continuous rail              | Duration is conveyed by labels and spans, rather than proportional vertical space |
| **B · Bands**         | Parallel rest, light and caffeine bands; a separate flight track | Easier to scan overlap, but relies more on the legend                             |
| **C · Journey cards** | More context, larger cards and a container spanning each flight  | More vertical scrolling                                                           |

Recommendation: start with A's compact navigation and expandable details, with stronger continuous activity bands from B. This is a proposal for review, not an implemented change to the production plan or the Flutter UI.

## Try it

- Scroll inside each phone across midnight and the clock handoff. On narrow screens, choose A, B or C using the tabs above the phone.
- Tap an activity, flight or clock-change banner to open its details. Escape, Done or the close button dismisses the dialog.
- Use **Start**, **Flight** or **Clock change** to align the comparison; **Now** returns to the sample current time.
- Toggle **Compress quiet time**. Flow and Journey cards compress uninterrupted rest as well as awake gaps; Bands retains the long activity strips and compresses only quiet gaps. Dotted rail sections indicate compressed time.
- Switch to **LAX → Melbourne** to inspect the SFO connection and the forward jump from Sunday 25 to Monday 26 October. The overnight rest and QF94 flight each remain one span through the jump.

Deep-link parameters: `?scenario=pacific&concept=bands&focus=switch`. Available concepts: `flow`, `bands`, `chapters`; focus: `start`, `flight`, `switch`. `capture=1` hides the bottom design notes for comparison screenshots.

## Timeline rules illustrated

Events and spans are ordered by absolute instants. The local clock switches at one explicitly marked instant during a flight. That handoff is a display choice, not a claim about the aircraft's physical position or when it crosses the international date line. Both local dates and clocks are shown at the handoff; elapsed flight and sleep durations do not change.

Midnight dividers use the active display timezone. A local date can repeat or skip at the handoff without adding or removing hours of the journey. A pinned date/city caption follows the scroll. Place names follow the airports, including San Francisco rather than the name of its IANA timezone.

Sleep, light, caffeine and flight tracks share the same time-to-position mapping within a concept. Long sleep and flight periods are continuous spans, rather than repeated hourly cards. Activity/flight details are initially collapsed. Optional melatonin is demonstrated as a small reminder with expandable guidance, without a dose.

The schedules are explicitly illustrative design fixtures. QF11 timing and guidance are not a booking lookup or the output of the clinical/planning engine. The Pacific flight times come from the existing provisional October test itinerary; its sample guidance and chosen handoff are illustrative too. There are no account, provider or production API calls.

## Previews

- [Three concepts at the timezone change](previews/clock-change.png)
- [Overnight and midnight dividers](previews/overnight.png)
- [Pacific date-line crossing](previews/date-line.png)
- Individual phone views: [Flow](previews/flow-mobile.png), [Bands](previews/bands-mobile.png), [Journey cards](previews/chapters-mobile.png)

The prototype uses browser-native HTML, CSS and JavaScript, with local Rephase fonts and simple inline SVG icons. No new application dependencies or production assets are required. Before integration, the chosen presentation should consume the shared plan's actual UTC intervals and existing details/recording controls, with equivalent Flutter behavior.

Browser verification covered both sample trips, continuous flight/rest geometry, timezone/date markers, expanded details and keyboard dismissal, the compression toggle, and all three concepts at six viewport widths (320–1360px). All 18 width/concept combinations fit without horizontal overflow; no browser script errors occurred. This is a design-only branch, so the production and native build suites were not run.
