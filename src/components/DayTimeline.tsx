import { useMemo, type ReactNode } from 'react';
import { Coffee, EyeOff, Moon, Pill, Plane, Sparkles, Sun, Sunrise } from 'lucide-react';
import { buildDayTimeline, timelineActionKind, type TimelineBand, type TimelineBandKind, type TimelineEntry } from '../lib/day-timeline';
import { buildTimelineSteps, type TimelineStep } from '../lib/timeline-steps';
import type { PlanCalendarDay } from '../lib/plan-calendar';
import { planDayCity } from '../lib/plan-places';
import { travelClock } from '../lib/travel-clocks';
import type { PlanAction, PlanTravelSegment } from '../lib/types';
import { FlightSegmentCard } from './FlightSegmentCard';

const kinds = ['awake', 'sleep', 'rest', 'light', 'avoid-light', 'caffeine', 'melatonin', 'flight'] as const;
const appearance = {
  awake: { label: 'Awake', icon: Sunrise, lane: 0 },
  sleep: { label: 'Sleep', icon: Moon, lane: 0 },
  rest: { label: 'Rest', icon: Sparkles, lane: 0 },
  light: { label: 'Light', icon: Sun, lane: 1 },
  'avoid-light': { label: 'Darkness', icon: EyeOff, lane: 2 },
  caffeine: { label: 'Caffeine', icon: Coffee, lane: 3 },
  melatonin: { label: 'Melatonin', icon: Pill, lane: 4 },
  flight: { label: 'Flight', icon: Plane, lane: 5 },
};

function durationLabel(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
}

function entryKind(entry: TimelineEntry): TimelineBandKind {
  return entry.kind === 'flight' ? 'flight' : timelineActionKind(entry.action);
}

/** One increasing UTC rail; local clock labels keep their dates and DST offsets. */
export function DayTimeline({ day, renderAction, renderFlight }: {
  day: PlanCalendarDay;
  renderAction: (action: PlanAction) => ReactNode;
  renderFlight?: (segment: PlanTravelSegment) => ReactNode;
}) {
  const timeline = useMemo(() => buildDayTimeline(day, { tickMinutes: 180 }), [day]);
  const steps = useMemo(() => buildTimelineSteps(timeline), [timeline]);
  const present = new Set(timeline.bands.map(band => band.kind));
  const clock = (instant: number) => travelClock(new Date(instant).toISOString(), timeline.timeZone);
  const firstClock = clock(timeline.start), lastClock = clock(timeline.end);
  const tailEntries = timeline.entries.filter(entry => entry.start === timeline.end);
  const travelDay = day.travelSegments.length > 0;
  const changingZone = firstClock.zone !== lastClock.zone;

  function renderEntry(entry: TimelineEntry) {
    const kind = entryKind(entry), end = clock(entry.end);
    const Icon = appearance[kind].icon;
    return <div className={`timeline-entry timeline-${kind}`} key={`${entry.kind}:${entry.id}`}
      data-kind={entry.kind} data-guidance={kind} data-start={entry.start} data-end={entry.end} data-entry-id={entry.id}>
      <div className="timeline-entry-caption"><Icon size={13} aria-hidden="true"/>
        <span>{entry.kind === 'flight' && entry.start === entry.end ? 'Arrival' : <>{entry.continuesBefore ? 'Continued · ' : ''}{durationLabel(entry.end - entry.start)}
          {entry.end > entry.start && <> · {entry.continuesAfter ? 'continues after this day' : `until ${end.time}${end.dateKey !== day.date ? `, ${end.date}` : ''}`}</>}</>}
        </span>
      </div>
      {entry.kind === 'flight' ? (renderFlight ? renderFlight(entry.flight) : <FlightSegmentCard segment={entry.flight} collapseMeals/>) : renderAction(entry.action)}
    </div>;
  }

  function continuation(bands: TimelineBand[]) {
    const unique = [...new Map(bands.map(band => [band.kind, band])).values()];
    return <div className="timeline-continuation">{unique.map(band => {
      const Icon = appearance[band.kind].icon;
      const end = clock(band.end);
      return <span className={`timeline-status timeline-${band.kind}`} key={band.kind}><Icon size={13} aria-hidden="true"/>{appearance[band.kind].label}<small>until {end.time}{end.dateKey !== day.date ? `, ${end.date}` : ''}</small></span>;
    })}</div>;
  }

  function startingStatuses(step: TimelineStep): TimelineBand[] {
    const represented = new Set(step.entries.map(entryKind));
    const fresh = step.bands.filter(band => band.start === step.start && !represented.has(band.kind));
    // Give an otherwise quiet awake span one label after the preceding
    // activity ends. Ongoing flights/sleep keep their visual band, not repeats.
    if (!fresh.length && step.compressed && !step.entries.length && step.bands.length === 1 && step.bands[0].kind === 'awake') return step.bands;
    return fresh;
  }

  return <section className="day-timeline" aria-label="Daily timeline" data-start={timeline.start} data-end={timeline.end}>
    <div className="timeline-heading"><div><span className="eyebrow muted">Your day, in order</span><p>{planDayCity(day)} time <span>· {firstClock.zone}{firstClock.zone !== lastClock.zone ? ` → ${lastClock.zone}` : ''}</span></p></div><span className="timeline-range">{durationLabel(timeline.end - timeline.start)}</span></div>
    <ul className="timeline-legend" aria-label="Timeline key">{kinds.filter(kind => present.has(kind)).map(kind => {
      const Icon = appearance[kind].icon;
      return <li className={`timeline-${kind}`} key={kind}><Icon size={13} aria-hidden="true"/>{appearance[kind].label}</li>;
    })}</ul>
    <ol className="timeline-steps">{steps.map(step => {
      const at = clock(step.start);
      const statuses = startingStatuses(step);
      return <li className={`timeline-step${step.compressed ? ' compressed' : ''}`} key={step.start} data-start={step.start} data-end={step.end} data-compressed={step.compressed}>
        <div className="timeline-clock"><time dateTime={new Date(step.start).toISOString()}><strong>{at.time}</strong>{(travelDay || at.dateKey !== day.date) && <span>{at.date}</span>}{(travelDay || changingZone) && <small>{at.zone}</small>}</time></div>
        <div className="timeline-rail" aria-hidden="true"><span className="timeline-dot"/>{step.bands.map(band => <span
          key={band.id} className={`timeline-band timeline-${band.kind}`} data-kind={band.kind}
          data-band-id={band.id} data-start={step.start} data-end={step.end}
          title={appearance[band.kind].label} style={{ left: `${appearance[band.kind].lane * 5}px` }}/>)}</div>
        <div className="timeline-step-content">{statuses.length > 0 && continuation(statuses)}{step.entries.map(renderEntry)}{step.compressed && <span className="timeline-elapsed">{durationLabel(step.end - step.start)} elapsed. Timeline compressed.</span>}</div>
      </li>;
    })}
      <li className="timeline-step timeline-end" data-start={timeline.end} data-end={timeline.end}>
        <div className="timeline-clock"><time dateTime={new Date(timeline.end).toISOString()}><strong>{lastClock.time}</strong><span>{lastClock.date}</span><small>{lastClock.zone}</small></time></div>
        <div className="timeline-rail" aria-hidden="true"><span className="timeline-dot"/></div>
        <div className="timeline-step-content">{tailEntries.length ? tailEntries.map(renderEntry) : <p className="timeline-end-label">End of this day</p>}</div>
      </li>
    </ol>
  </section>;
}
