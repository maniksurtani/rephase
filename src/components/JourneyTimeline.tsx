import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Check,
  Coffee,
  EyeOff,
  Info,
  Moon,
  Pill,
  Plane,
  PlaneLanding,
  Sparkles,
  Sun,
  Sunrise,
} from 'lucide-react';
import {
  journeyPosition,
  type JourneyBand,
  type JourneyTimeline as Journey,
} from '../lib/journey-timeline';
import type { PlanAction } from '../lib/types';
import type { LoungeFlightContext } from '../lib/lounge-windows';
import type { SleepEpisode, TimelineBandKind, TimelineEntry } from '../lib/day-timeline';
import { dateLabel } from '../lib/display';
import { FlightSegmentCard } from './FlightSegmentCard';
import { Modal } from './Modal';
import '../journey-timeline.css';

const icons = {
  awake: Sunrise,
  sleep: Moon,
  rest: Sparkles,
  light: Sun,
  'avoid-light': EyeOff,
  caffeine: Coffee,
  melatonin: Pill,
  flight: Plane,
};
type Detail =
  { kind: 'band'; band: JourneyBand } | { kind: 'event'; entry: TimelineEntry } | { kind: 'key' };
const descriptions: Partial<Record<TimelineBandKind, string>> = {
  awake: 'Awake time; other guidance can happen at the same time.',
  sleep: 'A window for sleep.',
  rest: 'An opportunity to rest or nap.',
  light: 'Seek daylight when practical.',
  'avoid-light': 'Keep light levels low.',
  caffeine: 'Optional caffeine within this window.',
  melatonin: 'Optional melatonin; tap the band for usage guidance.',
  flight: 'Flights run alongside the activity bands.',
};

export function JourneyTimeline({
  timeline,
  now,
  initialDate,
  onDate,
  renderAction,
  renderBeforeFlight,
}: {
  timeline: Journey;
  now: number;
  initialDate?: string;
  onDate?: (date: string) => void;
  renderAction: (action: PlanAction, episode?: SleepEpisode) => ReactNode;
  renderBeforeFlight: (context: LoungeFlightContext, compact?: boolean) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const dates = useRef<HTMLDivElement>(null);
  const anchor = useRef(initialDate);
  const didInitialize = useRef(false);
  const [position, setPosition] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const point =
    [...timeline.points].reverse().find((p) => p.top <= position + 8) ?? timeline.points[0];
  const activeDate = point.clock.dateKey;
  const scrollTo = (top: number, smooth = true) =>
    viewport.current?.scrollTo({
      top: Math.max(0, top),
      behavior:
        smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
    });

  useLayoutEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;
    const active = [...timeline.points].reverse().find((p) => p.at <= now) ?? timeline.points[0];
    const date = timeline.days.find((d) => d.date === anchor.current);
    const at =
      date && date.date !== active.clock.dateKey
        ? date.y
        : now >= timeline.start && now < timeline.end
          ? journeyPosition(timeline, now) - 80
          : now >= timeline.end
            ? timeline.days.at(-1)!.y
            : 0;
    scrollTo(at, false);
    setPosition(viewport.current?.scrollTop ?? Math.max(0, at));
  }, [timeline, now]);

  useEffect(() => {
    if (Math.abs((viewport.current?.scrollTop ?? 0) - position) < 1) onDate?.(activeDate);
  }, [activeDate, position, onDate]);

  useLayoutEffect(() => {
    const strip = dates.current,
      selected = strip?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!strip || !selected) return;
    const a = strip.getBoundingClientRect(),
      b = selected.getBoundingClientRect();
    if (b.left < a.left || b.right > a.right)
      strip.scrollTo({
        left: strip.scrollLeft + b.left - a.left - (a.width - b.width) / 2,
        behavior: 'instant',
      });
  }, [activeDate]);

  function eventDetail(entry: TimelineEntry) {
    if (entry.kind === 'flight') return <FlightSegmentCard segment={entry.flight} collapseMeals />;
    if (entry.kind === 'lounge') return renderBeforeFlight(entry.lounge);
    return renderAction(entry.action, entry.sleepEpisode);
  }
  const title =
    detail?.kind === 'key'
      ? 'Reading your timeline'
      : detail?.kind === 'band'
        ? detail.band.label
        : detail?.entry.kind === 'flight'
          ? 'Your flight'
          : 'Before your flight';
  return (
    <section
      className="journey-timeline"
      aria-label="Continuous journey timeline"
      data-start={timeline.start}
      data-end={timeline.end}
    >
      <div
        ref={dates}
        className="day-navigation journey-dates"
        role="group"
        aria-label="Choose a plan day"
      >
        {timeline.days.map((day) => (
          <button
            type="button"
            key={day.date}
            className={`day-button ${day.travel ? 'travel-day' : ''} ${day.date === activeDate ? 'selected' : ''}`}
            data-date={day.date}
            aria-pressed={day.date === activeDate}
            title={`${dateLabel(day.date, 'long')} · ${day.city}`}
            onClick={() => {
              scrollTo(day.y);
              onDate?.(day.date);
            }}
          >
            <span>{dateLabel(day.date).split(',')[0].split(' ')[0]}</span>
            <strong>{Number(day.date.slice(8, 10))}</strong>
            <small>
              {day.travel ? (
                <>
                  <Plane size={12} /> Travel
                </>
              ) : (
                day.city
              )}
            </small>
          </button>
        ))}
      </div>
      <div className="journey-toolbar">
        <div className="journey-context">
          <strong>{dateLabel(activeDate)}</strong>
          <span>
            {point.city} · {point.clock.zone}
          </span>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            scrollTo(
              journeyPosition(timeline, Math.max(timeline.start, Math.min(now, timeline.end))) - 80,
            )
          }
        >
          Now
        </button>
        <button className="text-button" type="button" onClick={() => setDetail({ kind: 'key' })}>
          <Info size={15} /> Key
        </button>
      </div>
      <div
        ref={viewport}
        className="journey-viewport"
        role="region"
        tabIndex={0}
        aria-label="Journey bands"
        onScroll={(event) => setPosition(event.currentTarget.scrollTop)}
      >
        <div className="journey-canvas" style={{ height: timeline.height }}>
          {timeline.points
            .filter((p) => p.end > p.at)
            .map((p) => (
              <div
                key={p.at}
                className={`journey-rail ${p.compressed ? 'compressed' : ''}`}
                style={{ top: p.y, height: p.height }}
                data-start={p.at}
                data-end={p.end}
                data-compressed={p.compressed}
              />
            ))}
          {timeline.ticks.map((tick) => (
            <div key={tick.at} className="journey-tick" style={{ top: tick.top }}>
              <time
                dateTime={new Date(tick.at).toISOString()}
                title={`${tick.clock.date} · ${tick.clock.zone}`}
              >
                {tick.clock.time}
              </time>
              <span />
            </div>
          ))}
          {timeline.bands.map((band) => {
            if (band.kind === 'flight')
              return (
                <div
                  className="journey-flight-span"
                  key={band.id}
                  data-flight-id={band.flight?.id}
                  data-start={band.start}
                  data-end={band.end}
                  style={{ top: band.top, height: band.height }}
                  aria-label={`${band.label} · ${band.duration}`}
                >
                  <span>{band.label}</span>
                </div>
              );
            const Icon = icons[band.kind];
            return (
              <button
                type="button"
                key={band.id}
                className={`journey-band journey-${band.kind}`}
                data-band-id={band.id}
                data-kind={band.kind}
                data-start={band.start}
                data-end={band.end}
                style={
                  {
                    top: band.top,
                    height: band.height,
                    '--lane': band.lane,
                    '--divisions': band.laneCount,
                  } as CSSProperties
                }
                aria-label={`${band.label}, ${band.duration}, details`}
                onClick={() => setDetail({ kind: 'band', band })}
              >
                <span className="journey-band-label">
                  <Icon size={16} aria-hidden="true" />
                  <strong>{band.label}</strong>
                  <small>{band.duration}</small>
                  {['caffeine', 'melatonin'].includes(band.kind) && <small>Optional</small>}
                </span>
              </button>
            );
          })}
          {timeline.events.map(({ entry, top }) => {
            if (entry.kind === 'action') return null;
            if (entry.kind === 'lounge')
              return (
                <div
                  key={entry.id}
                  className="journey-flight-marker journey-lounge"
                  data-entry-id={entry.id}
                  data-kind="lounge"
                  data-start={entry.start}
                  style={{ top }}
                >
                  {renderBeforeFlight(entry.lounge, true)}
                </div>
              );
            const flight = entry.flight;
            const arrival = entry.phase === 'arrival';
            const Icon = arrival ? PlaneLanding : Plane;
            const label = arrival ? 'Arrive' : flight.flightNumber || 'Flight';
            const route = arrival
              ? flight.arrivalAirport
              : `${flight.departureAirport}–${flight.arrivalAirport}`;
            return (
              <button
                type="button"
                key={entry.id}
                className={`journey-flight-marker ${flight ? '' : 'journey-lounge'}`}
                style={{ top }}
                data-entry-id={entry.id}
                data-kind={entry.kind}
                data-start={entry.start}
                data-flight-id={flight?.id}
                data-phase={entry.kind === 'flight' ? entry.phase : undefined}
                aria-label={`${label} ${route}, ${flight ? 'flight details' : 'explore lounges'}`}
                onClick={() => setDetail({ kind: 'event', entry })}
              >
                <Icon size={16} aria-hidden="true" />
                <strong>{label}</strong>
                <small>{route}</small>
              </button>
            );
          })}
          {timeline.markers.map((marker) =>
            marker.kind === 'clock' ? (
              <div
                key={marker.at}
                className="journey-clock-fold"
                style={{ top: marker.top, height: marker.height }}
                data-at={marker.at}
                role="note"
                aria-label={`Clock change: ${marker.fromCity} ${marker.fromClock!.date} ${marker.fromClock!.time} to ${marker.city} ${marker.clock.date} ${marker.clock.time}. Same instant.`}
              >
                <div className="journey-fold-paper" />
                <div className="journey-fold-clock before">
                  <span>
                    {marker.fromCity}
                    <small>
                      {marker.fromClock!.date} · {marker.fromClock!.zone}
                    </small>
                  </span>
                  <strong>{marker.fromClock!.time}</strong>
                </div>
                <div className="journey-fold-seam">
                  <span>Clock changes {marker.change}</span>
                </div>
                <div className="journey-fold-clock after">
                  <span>
                    {marker.city}
                    <small>
                      {marker.clock.date} · {marker.clock.zone}
                    </small>
                  </span>
                  <strong>{marker.clock.time}</strong>
                </div>
              </div>
            ) : (
              <div
                key={marker.at}
                className="journey-midnight"
                style={{ top: marker.top }}
                data-at={marker.at}
              >
                <strong>{dateLabel(marker.clock.dateKey)}</strong>
                <span>
                  {marker.city} · {marker.clock.time}
                </span>
              </div>
            ),
          )}
          {now >= timeline.start && now < timeline.end && (
            <div className="journey-now" style={{ top: journeyPosition(timeline, now) }}>
              <span>Now</span>
            </div>
          )}
          <div className="journey-complete trip-complete" style={{ top: timeline.height - 100 }}>
            <Check size={19} />
            <div>
              <h3>Trip complete</h3>
              <p>Return to your usual routine.</p>
            </div>
          </div>
        </div>
      </div>
      {detail && (
        <Modal title={title} onClose={() => setDetail(null)} className="journey-details">
          {detail.kind === 'key' ? (
            <div className="journey-key">
              <p>
                Bands at the same height happen at the same time. Tap a band or flight for details.
              </p>
              {Object.entries(descriptions).map(([kind, description]) => {
                const Icon = icons[kind as TimelineBandKind];
                return (
                  <p key={kind}>
                    <Icon size={18} />
                    <span>{description}</span>
                  </p>
                );
              })}
              <p>
                The folded line changes the displayed clock during a flight. Both clocks show the
                same instant.
              </p>
              <p>Dotted sections compress quiet awake time.</p>
            </div>
          ) : detail.kind === 'event' ? (
            eventDetail(detail.entry)
          ) : (
            <>
              <p className="small-copy">
                {detail.band.duration} · {detail.band.label}
              </p>
              {detail.band.actions.length ? (
                detail.band.actions.map((action) => (
                  <div key={`${action.id}:${action.start}`}>{renderAction(action)}</div>
                ))
              ) : (
                <p>{descriptions[detail.band.kind]}</p>
              )}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
