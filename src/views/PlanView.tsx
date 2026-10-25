import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LoungeFlightContext } from '../lib/lounge-windows';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe2,
  Info,
  Moon,
  Pencil,
  Plane,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { Plan, PlanAction, Trip } from '../lib/types';
import type { PlanViewState } from '../lib/usePlanView';
import {
  dateLabel,
  localDate,
  phaseChangeLabel,
  plural,
  remainingAdjustmentLabel,
  time,
  zoneName,
} from '../lib/display';
import { planDayCity } from '../lib/plan-places';
import { exportCalendar } from '../lib/export';
import { DayTimeline } from '../components/DayTimeline';
import { ActionCard, actionMeta } from '../components/ActionCard';

interface PlanViewProps {
  trip: Trip | null;
  plan: Plan | null;
  view: PlanViewState;
  loading: boolean;
  calendarAlarms: boolean;
  onCreateTrip: () => void;
  onEditTrip: (trip: Trip) => void;
  onSelectDay: (id: string | null) => void;
  onScience: () => void;
  onRecord: (action: PlanAction) => void;
  loungeContexts: LoungeFlightContext[];
  renderBeforeFlight: (context: LoungeFlightContext) => ReactNode;
}
export function PlanView({
  trip,
  plan,
  view,
  loading,
  calendarAlarms,
  onCreateTrip,
  onEditTrip,
  onSelectDay,
  onScience,
  onRecord,
  loungeContexts,
  renderBeforeFlight,
}: PlanViewProps) {
  const { calendarDays, selectedDay, currentAction, isDemo } = view;
  const dayNavigationRef = useRef<HTMLDivElement>(null);
  const selectedDayRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const navigation = dayNavigationRef.current;
    const selected = selectedDayRef.current;
    if (!navigation || !selected) return;
    const strip = navigation.getBoundingClientRect();
    const tile = selected.getBoundingClientRect();
    if (tile.left >= strip.left && tile.right <= strip.right) return;
    // Scroll only the date strip; scrollIntoView can also move the page vertically.
    navigation.scrollTo({
      left: navigation.scrollLeft + tile.left - strip.left - (strip.width - tile.width) / 2,
      behavior: 'instant',
    });
  }, [calendarDays, selectedDay?.id]);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow muted">One journey. One continuous rhythm.</span>
          <h1>Your travel plan</h1>
          <p>From the first preparation day to your final arrival.</p>
        </div>
        <div className="heading-actions">
          {isDemo && <span className="pill demo-pill">Example trip</span>}
          {plan && trip && (
            <button
              type="button"
              className="button secondary"
              onClick={() => exportCalendar(plan, trip, calendarAlarms)}
            >
              <Download size={16} />
              Calendar
            </button>
          )}
        </div>
      </div>
      {!trip || !plan ? (
        loading ? (
          <p className="small-copy">
            You can keep editing your trip while your plan is calculated.
          </p>
        ) : (
          <EmptyPlan onCreate={onCreateTrip} />
        )
      ) : (
        <>
          <div className="plan-trip-bar">
            <div className="plan-trip-name">
              <span className="small-icon">
                <Plane size={19} />
              </span>
              <div>
                <h2>{trip.name}</h2>
                <span>
                  {plural(plan.summary.destinations, 'destination')} ·{' '}
                  {plural(plan.summary.timeZoneChanges, 'time zone change')}
                </span>
              </div>
            </div>
            <button type="button" className="text-button" onClick={() => onEditTrip(trip)}>
              <Pencil size={14} />
              Edit trip
            </button>
          </div>
          {isDemo && (
            <div className="demo-note">
              <Info size={16} />
              <p>Explore the example plan, then replace it with your own trip.</p>
              <button type="button" onClick={onCreateTrip}>
                Add your flights <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div
            ref={dayNavigationRef}
            className="day-navigation"
            role="group"
            aria-label="Choose a plan day"
          >
            {calendarDays.map((day) => (
              <button
                type="button"
                key={day.id}
                ref={day.id === selectedDay?.id ? selectedDayRef : undefined}
                className={`day-button ${day.travelSegments?.length ? 'travel-day' : ''} ${day.id === selectedDay?.id ? 'selected' : ''}`}
                data-date={day.date}
                data-zone={day.timeZone}
                title={`${dateLabel(day.date, 'long')} · ${planDayCity(day)}${day.travelSegments?.length ? ` · ${day.travelSegments.map((segment) => segment.flightNumber || `${segment.departureAirport} → ${segment.arrivalAirport}`).join(', ')}` : ''}`}
                aria-pressed={day.id === selectedDay?.id}
                onClick={() => onSelectDay(day.id)}
              >
                <span>{dateLabel(day.date).split(',')[0].split(' ')[0]}</span>
                <strong>{Number(day.date.slice(8, 10))}</strong>
                <small>
                  {day.travelSegments?.length ? (
                    <>
                      <Plane size={11} />
                      Travel
                    </>
                  ) : day.stage === 'preparation' ? (
                    'Prepare'
                  ) : (
                    planDayCity(day)
                  )}
                </small>
                {Boolean(day.travelSegments?.length) && (
                  <span className="day-zone">
                    {[
                      ...new Set(
                        day.travelSegments.flatMap((segment) => [
                          segment.departureAirport,
                          segment.arrivalAirport,
                        ]),
                      ),
                    ].join(' · ')}
                  </span>
                )}
              </button>
            ))}
          </div>
          {selectedDay && (
            <div className="plan-layout">
              <section>
                <div className="agenda-heading">
                  <div>
                    <span className={`stage-label ${selectedDay.stage}`}>
                      {selectedDay.travelSegments?.length ? <Plane size={13} /> : <span />}
                      {selectedDay.label}
                    </span>
                    <h2>{dateLabel(selectedDay.date, 'long')}</h2>
                    <p className="timezone-caption">
                      <Globe2 size={14} />
                      {selectedDay.travelSegments?.length
                        ? 'One date, both airport clocks. Every time includes its local date.'
                        : `All times in ${planDayCity(selectedDay)} · ${zoneName(selectedDay.timeZone, selectedDay.actions[0]?.start)}`}
                    </p>
                  </div>
                  <div className="day-arrows">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Previous plan day"
                      disabled={calendarDays.indexOf(selectedDay) === 0}
                      onClick={() =>
                        onSelectDay(calendarDays[calendarDays.indexOf(selectedDay) - 1]?.id)
                      }
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Next plan day"
                      disabled={calendarDays.indexOf(selectedDay) === calendarDays.length - 1}
                      onClick={() =>
                        onSelectDay(calendarDays[calendarDays.indexOf(selectedDay) + 1]?.id)
                      }
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
                <DayTimeline
                  key={selectedDay.id}
                  day={selectedDay}
                  loungeContexts={loungeContexts}
                  renderBeforeFlight={renderBeforeFlight}
                  renderAction={(action, sleepEpisode) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      timeline
                      sleepEpisode={sleepEpisode}
                      travelSegments={selectedDay.travelSegments}
                      isCurrent={!isDemo && action.id === currentAction?.id}
                      record={trip.adherence?.find((entry) => entry.actionId === action.id)}
                      onRecord={isDemo ? undefined : onRecord}
                    />
                  )}
                />
              </section>
              <aside className="plan-aside">
                <section className="plan-note-card">
                  <span className="eyebrow muted">
                    <Sparkles size={14} />
                    Your body clock · {planDayCity(selectedDay)}
                  </span>
                  <h3>Estimated adjustment</h3>
                  {selectedDay.phaseEstimateAvailable !== false ? (
                    <>
                      <div className="phase-meter">
                        <span>Change today</span>
                        <strong>{phaseChangeLabel(selectedDay.phaseShiftHours)}</strong>
                      </div>
                      <p>
                        Remaining adjustment:{' '}
                        <strong>{remainingAdjustmentLabel(selectedDay.remainingShiftHours)}</strong>
                      </p>
                    </>
                  ) : (
                    <div className="phase-unavailable">
                      <span>Change today</span>
                      <p>Not enough history for a daily estimate.</p>
                    </div>
                  )}
                  <p className="small-copy">
                    <a href="/science.html#limits">How estimates work</a>
                  </p>
                </section>
                <section className="plan-note-card muted-card">
                  <h3>Light tips</h3>
                  <p>
                    Seek outdoor light when you can. For light avoidance, dim indoor lighting and
                    reduce bright screens.
                  </p>
                  <button type="button" className="text-button" onClick={() => onScience()}>
                    Understand the timing <ArrowUpRight size={14} />
                  </button>
                </section>
              </aside>
            </div>
          )}

          {trip.adherence?.length ? (
            <details className="plan-warnings">
              <summary>
                Your recorded history <span>{trip.adherence.length}</span>
              </summary>
              <ul>
                {trip.adherence
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      {actionMeta[entry.type].label} ·{' '}
                      {dateLabel(localDate(entry.scheduledStart, entry.timeZone))}{' '}
                      {time(entry.scheduledStart, entry.timeZone)} · {entry.status}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          {plan.warnings.length > 0 && (
            <details className="plan-warnings">
              <summary>
                <Info size={16} />
                Plan notes & limitations <span>{plan.warnings.length}</span>
              </summary>
              <ul>
                {plan.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}

function EmptyPlan({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="empty-card large-empty">
      <span className="empty-orbit">
        <Moon size={35} />
      </span>
      <h2>Your next journey starts here</h2>
      <p>Add your flights and we’ll build a continuous plan for every stop.</p>
      <button type="button" className="button primary" onClick={onCreate}>
        <Plus size={16} />
        Plan a trip
      </button>
    </section>
  );
}
