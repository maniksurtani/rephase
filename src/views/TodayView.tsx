import type { ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  Info,
  Moon,
  Plane,
  Plus,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { Plan, PlanTravelSegment, Preferences, Trip } from '../lib/types';
import type { PlanViewState } from '../lib/usePlanView';
import { airportCity, dateLabel, localDate, time, zoneName } from '../lib/display';
import { actionCity, planDayCity } from '../lib/plan-places';
import { ActionCard, actionMeta } from '../components/ActionCard';
import { MoonScene } from '../components/MoonScene';
import { MelatoninGuidance } from '../components/MelatoninGuidance';
import { todayPreview } from '../lib/plan-view';

interface TodayViewProps {
  trip: Trip | null;
  preferences: Preferences;
  plan: Plan | null;
  view: PlanViewState;
  now: Date;
  onViewPlan: () => void;
  onViewTrips: () => void;
  onPreferences: () => void;
  onCreateTrip: () => void;
  renderFlight: (segment: PlanTravelSegment) => ReactNode;
}
export function TodayView({
  trip,
  preferences,
  plan,
  view,
  now,
  onViewPlan,
  onViewTrips,
  onPreferences,
  onCreateTrip,
  renderFlight,
}: TodayViewProps) {
  const { currentAction, nextAction, today, timelineDay, itineraryFinished, isDemo } = view;
  const featuredAction = currentAction && !isDemo ? currentAction : nextAction;
  const preview = timelineDay
    ? todayPreview(timelineDay, now.getTime(), view.calendarDays)
    : undefined;
  return (
    <>
      <section className="welcome-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="small-line" />A softer landing
          </span>
          <h1>
            New time zone.
            <br />
            <span>Same you.</span>
          </h1>
          <p>
            Your personal light, sleep, and travel plan.
            <br className="desktop-break" /> Arrive with your body clock a little more on your side.
          </p>
          <button
            type="button"
            className="button primary hero-button"
            onClick={() => (trip ? onViewPlan() : onCreateTrip())}
          >
            {trip ? 'Explore your plan' : 'Plan your first trip'}
            <ArrowRight size={17} />
          </button>
        </div>
        <MoonScene />
      </section>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <div className="section-heading">
            <div>
              <span className="eyebrow muted">Your next adventure</span>
              <h2>{trip?.name ?? 'Where are you headed?'}</h2>
            </div>
            {isDemo && <span className="pill demo-pill">Example trip</span>}
          </div>
          {trip ? (
            <section className="trip-summary-card">
              <div className="trip-route">
                {trip.legs.slice(0, 5).map((leg, i) => (
                  <div className="route-segment" key={leg.id}>
                    {i === 0 && (
                      <>
                        <div className="route-point">
                          <span className="route-airport">{leg.departureAirport}</span>
                          <span>{airportCity(leg.departureAirport)}</span>
                        </div>
                        <div className="route-connector">
                          <span />
                          <Plane size={15} />
                          <span />
                        </div>
                      </>
                    )}
                    <div className="route-point">
                      <span className="route-airport">{leg.arrivalAirport}</span>
                      <span>{airportCity(leg.arrivalAirport)}</span>
                      {leg.stayAfter === 'connection' && <small>Connection</small>}
                    </div>
                    {i < Math.min(trip.legs.length, 5) - 1 && (
                      <div className="route-connector">
                        <span />
                        <Plane size={15} />
                        <span />
                      </div>
                    )}
                  </div>
                ))}
                {trip.legs.length > 5 && (
                  <span className="more-stops">+{trip.legs.length - 5}</span>
                )}
              </div>
              <div className="trip-summary-footer">
                <span>
                  <CalendarDays size={15} />
                  {dateLabel(trip.legs[0]?.departureDateTime ?? '')}
                  {trip.legs.length > 1 &&
                    ` – ${dateLabel(trip.legs.at(-1)?.arrivalDateTime ?? '')}`}
                </span>
                <button type="button" className="text-button" onClick={() => onViewTrips()}>
                  Trip details <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          ) : (
            <section className="empty-card">
              <Plane size={28} />
              <h3>Start with your flights</h3>
              <p>Add each stop, and we’ll connect the whole journey into one plan.</p>
              <button type="button" className="button primary" onClick={onCreateTrip}>
                <Plus size={16} />
                Add a trip
              </button>
            </section>
          )}
          {plan && (
            <section className="today-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow muted">
                    {today
                      ? 'Your daily rhythm'
                      : itineraryFinished
                        ? 'Your journey'
                        : 'A little preparation goes a long way'}
                  </span>
                  <h2>
                    {today
                      ? 'Today, at a glance'
                      : itineraryFinished
                        ? 'This plan is complete'
                        : 'Your first steps'}
                  </h2>
                </div>
                {timelineDay && <span className="subtle-label">{dateLabel(timelineDay.date)}</span>}
              </div>
              {isDemo && (
                <div className="demo-note">
                  <Info size={16} />
                  <p>
                    This is a sample itinerary. Add your flights and sleep preferences for a
                    personal plan.
                  </p>
                  <button type="button" onClick={onCreateTrip}>
                    Make it yours <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {!today && timelineDay && (
                <div className="upcoming-note">
                  <CalendarDays size={17} />
                  <span>
                    Your {timelineDay.stage === 'preparation' ? 'preparation' : 'next plan day'}{' '}
                    begins <strong>{dateLabel(timelineDay.date, 'long')}</strong>.{' '}
                    {timelineDay.travelSegments?.length
                      ? 'Flight and recommendation times include both origin and destination clocks.'
                      : `Times below are in ${planDayCity(timelineDay)} (${zoneName(timelineDay.timeZone, timelineDay.actions[0]?.start)}).`}
                  </span>
                </div>
              )}
              {today && (
                <p className="timezone-caption">
                  <Globe2 size={14} />
                  {today.travelSegments.length
                    ? 'Travel day · both airport clocks below'
                    : `${planDayCity(today)} local time · ${zoneName(today.timeZone, today.actions[0]?.start)}`}
                </p>
              )}
              {preview?.flights.length ? (
                <div className="day-flights">
                  {preview.flights.map((segment) => (
                    <div key={segment.id}>{renderFlight(segment)}</div>
                  ))}
                </div>
              ) : null}
              {timelineDay && preview && (
                <div className="action-list">
                  {preview.actions.length > 0 && preview.actionDay.id !== timelineDay.id && (
                    <p className="small-copy">
                      {Date.parse(preview.actions[0].start) <= now.getTime() ? 'Ongoing' : 'Next'} ·{' '}
                      {dateLabel(preview.actionDay.date, 'long')}
                    </p>
                  )}
                  {preview.actions.map((action) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      compact
                      travelSegments={preview.actionDay.travelSegments}
                      isCurrent={Boolean(today) && Date.parse(action.start) <= now.getTime()}
                    />
                  ))}
                </div>
              )}
              {today && preview && !preview.actions.length && !preview.flights.length && (
                <p className="small-copy">No more recommendations today.</p>
              )}
              {itineraryFinished && (
                <div className="empty-card subtle">
                  <CheckCircle2 size={28} />
                  <p>
                    Your saved itinerary has ended. Create your next trip whenever you’re ready.
                  </p>
                </div>
              )}
              <button
                type="button"
                className="button quiet full-plan-button"
                onClick={() => onViewPlan()}
              >
                See the full timeline <ArrowRight size={16} />
              </button>
            </section>
          )}
        </div>
        <aside className="insight-rail">
          <section className="next-action-card">
            <span className="eyebrow muted">
              <Clock3 size={14} />
              {currentAction && !isDemo ? 'Happening now' : 'Next in your rhythm'}
            </span>
            {(currentAction && !isDemo ? currentAction : nextAction) ? (
              <>
                <div
                  className={`next-action-icon ${actionMeta[(currentAction && !isDemo ? currentAction : nextAction)!.type].color}`}
                >
                  {(() => {
                    const Icon =
                      actionMeta[(currentAction && !isDemo ? currentAction : nextAction)!.type]
                        .icon;
                    return <Icon size={27} />;
                  })()}
                </div>
                <h3>{(currentAction && !isDemo ? currentAction : nextAction)!.title}</h3>
                {featuredAction?.type === 'melatonin' ? (
                  <MelatoninGuidance key={featuredAction.id} action={featuredAction} />
                ) : (
                  <p>{featuredAction!.detail}</p>
                )}
                <div className="next-action-time">
                  <strong>
                    {time(
                      (currentAction && !isDemo ? currentAction : nextAction)!.start,
                      (currentAction && !isDemo ? currentAction : nextAction)!.timeZone,
                    )}
                  </strong>
                  <span>
                    {dateLabel(
                      localDate(
                        (currentAction && !isDemo ? currentAction : nextAction)!.start,
                        (currentAction && !isDemo ? currentAction : nextAction)!.timeZone,
                      ),
                    )}{' '}
                    ·{' '}
                    {actionCity(
                      (currentAction && !isDemo ? currentAction : nextAction)!,
                      plan?.days ?? [],
                    )}
                  </span>
                </div>
                {isDemo && (
                  <span className="sample-caption">Preview from the example itinerary</span>
                )}
              </>
            ) : (
              <>
                <div className="next-action-icon sleep">
                  <Moon size={27} />
                </div>
                <h3>Your rhythm starts here</h3>
                <p>Add an upcoming trip to see your next action.</p>
              </>
            )}
          </section>
          <section className="profile-snapshot">
            <span className="eyebrow muted">Built around you</span>
            <h3>Your everyday rhythm</h3>
            <div className="sleep-clock">
              <span>
                <Moon size={16} />
                <strong>{preferences.usualBedtime}</strong>
                <small>Usual bedtime</small>
              </span>
              <span className="sleep-clock-divider" />
              <span>
                <Sun size={16} />
                <strong>{preferences.usualWakeTime}</strong>
                <small>Usual wake time</small>
              </span>
            </div>
            <div className="profile-facts">
              <span>{preferences.sleepHours} hours of sleep</span>
              <span>
                {preferences.chronotype === 'unsure'
                  ? 'Chronotype: unsure'
                  : `${preferences.chronotype[0].toUpperCase()}${preferences.chronotype.slice(1)} chronotype`}
              </span>
            </div>
            <button type="button" className="text-button" onClick={() => onPreferences()}>
              Adjust your preferences <ArrowUpRight size={14} />
            </button>
          </section>
          <div className="quiet-tip">
            <Sparkles size={17} />
            <p>
              Light is your body clock’s strongest time cue. Small changes at the right time can
              help.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
