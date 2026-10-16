import { Moon, Plane, Utensils } from 'lucide-react';
import type { PlanTravelSegment } from '../lib/types';
import { travelClock } from '../lib/travel-clocks';
import { aircraftLabel } from '../lib/aircraft';
import '../flight-details.css';

export function FlightSegmentCard({
  segment,
  collapseMeals = false,
}: {
  segment: PlanTravelSegment;
  collapseMeals?: boolean;
}) {
  function clockRow(
    instant: string,
    airport: string,
    timeZone: string,
    side: 'origin' | 'destination',
  ) {
    const clock = travelClock(instant, timeZone);
    return (
      <div className={`flight-clock flight-clock-${side}`}>
        <span className="flight-clock-label">
          {airport} {side === 'origin' ? 'origin' : 'destination'}
        </span>
        <time dateTime={instant}>
          <strong>{clock.time}</strong>
          <span>
            {clock.date} · {clock.zone}
          </span>
        </time>
      </div>
    );
  }
  const mealDetails = segment.mealPlan && (
    <>
      <p className="meal-reason">{segment.mealPlan.reason}</p>
      {segment.mealPlan.windows.length ? (
        <ul className="meal-windows">
          {segment.mealPlan.windows.map((window) => (
            <li className="meal-window" key={window.id}>
              <h5>
                <Utensils size={13} />
                {window.title}
              </h5>
              <div className="meal-window-clocks">
                {[
                  {
                    airport: segment.departureAirport,
                    zone: segment.departureTimeZone,
                    role: 'Origin',
                  },
                  {
                    airport: segment.arrivalAirport,
                    zone: segment.arrivalTimeZone,
                    role: 'Destination',
                  },
                ].map((clock) => {
                  const start = travelClock(window.start, clock.zone),
                    end = travelClock(window.end, clock.zone);
                  return (
                    <div className="meal-clock" key={clock.role}>
                      <span>
                        {clock.airport} · {clock.role} · {start.zone}
                        {start.zone !== end.zone ? ` → ${end.zone}` : ''}
                      </span>
                      <strong>
                        <time dateTime={window.start}>
                          {start.date} {start.time}
                        </time>{' '}
                        –{' '}
                        <time dateTime={window.end}>
                          {end.date} {end.time}
                        </time>
                      </strong>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meal-no-window">
          No practical meal window fits around this leg. Eat when awake and able; there is no need
          to skip food to follow this plan.
        </p>
      )}
      <p className="meal-flexibility">
        Suggested windows, with no meal alarms. Confirm service with the crew; choose a light snack
        close to sleep. <a href="/science.html#meals">Why these timings?</a>
      </p>
    </>
  );
  return (
    <article
      className="flight-segment-card"
      data-flight-id={segment.id}
      aria-label={`${segment.flightNumber ? `${segment.flightNumber} · ` : ''}${segment.departureAirport} to ${segment.arrivalAirport} flight`}
    >
      <header className="flight-segment-header">
        <Plane size={19} aria-hidden="true" />
        <div>
          <span className="flight-segment-label">
            Flight{segment.flightNumber ? ` · ${segment.flightNumber}` : ''}
          </span>
          <h3>
            {segment.departureAirport} <span aria-hidden="true">→</span> {segment.arrivalAirport}
          </h3>
        </div>
      </header>
      <details className="flight-details">
        <summary>Flight details</summary>
        {aircraftLabel(segment.aircraft) && (
          <p className="flight-segment-aircraft">Aircraft · {aircraftLabel(segment.aircraft)}</p>
        )}
        <div className="flight-segment-events">
          <section className="flight-segment-event" aria-label="Departure">
            <h4>Departure</h4>
            {clockRow(
              segment.departure,
              segment.departureAirport,
              segment.departureTimeZone,
              'origin',
            )}
            {clockRow(
              segment.departure,
              segment.arrivalAirport,
              segment.arrivalTimeZone,
              'destination',
            )}
          </section>
          <section className="flight-segment-event" aria-label="Arrival">
            <h4>Arrival</h4>
            {clockRow(
              segment.arrival,
              segment.departureAirport,
              segment.departureTimeZone,
              'origin',
            )}
            {clockRow(
              segment.arrival,
              segment.arrivalAirport,
              segment.arrivalTimeZone,
              'destination',
            )}
          </section>
        </div>
      </details>
      {segment.mealPlan && (
        <section className="meal-plan" aria-label="Meals and sleep for this flight">
          <div className="meal-policy-heading">
            {segment.mealPlan.wakeForMeals ? <Utensils size={17} /> : <Moon size={17} />}
            <div>
              <span>Meals & sleep</span>
              <h4 className="meal-policy">{segment.mealPlan.advice}</h4>
            </div>
          </div>
          {collapseMeals ? (
            <details className="meal-details">
              <summary>Meal times & details</summary>
              {mealDetails}
            </details>
          ) : (
            mealDetails
          )}
        </section>
      )}
    </article>
  );
}
