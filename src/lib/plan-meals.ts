import { flightAirborneTiming } from './flight-timing';
import { localToInstant } from './time';
import type { FlightLeg, FlightMealPlan, MealWindow, Plan, Trip } from './types';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE;
const MIN_MEAL = 20 * MINUTE,
  MEAL = 30 * MINUTE;
type Range = { start: number; end: number };
type Flight = Range & { leg: FlightLeg; takeoff: number; landing: number };
type Context = { flights: Flight[]; sleeps: Range[]; uncertainSleeps: Range[] };
const iso = (instant: number) => new Date(instant).toISOString();

function merge(ranges: Range[]): Range[] {
  const result: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (!(range.end > range.start)) continue;
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function subtract(range: Range, blocked: Range[]): Range[] {
  let result = range.end > range.start ? [range] : [];
  for (const block of merge(blocked))
    result = result.flatMap((piece) => {
      if (block.end <= piece.start || block.start >= piece.end) return [piece];
      return [
        { start: piece.start, end: Math.min(piece.end, block.start) },
        { start: Math.max(piece.start, block.end), end: piece.end },
      ].filter((part) => part.end - part.start >= MIN_MEAL);
    });
  return result.filter((piece) => piece.end - piece.start >= MIN_MEAL);
}

function resolveSleepIntervals(
  plan: Plan,
  trip: Trip,
): Pick<Context, 'sleeps' | 'uncertainSleeps'> {
  // Preserved observations retain their original action ID, including midnight
  // splits. A newly generated recommendation can share that ID, so only the
  // planner's explicit logged-action marker identifies recorded history.
  const sleepLogs = new Map(
    (trip.adherence ?? [])
      .filter((record) => record.tripId === trip.id && record.type === 'sleep')
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .map((record) => [record.actionId, record]),
  );
  const uncertainSleeps: Range[] = [];
  const sleeps = plan.days.flatMap((day) =>
    day.actions
      .filter((action) => action.type === 'sleep')
      .flatMap((action) => {
        const scheduled = { start: Date.parse(action.start), end: Date.parse(action.end) };
        const record = action.origin === 'observation' ? sleepLogs.get(action.id) : undefined;
        if (!record) return [scheduled];
        if (record.status === 'missed') return [];
        if (record.actualStart && record.actualEnd) {
          const actual = {
            start: Date.parse(record.actualStart),
            end: Date.parse(record.actualEnd),
          };
          if (
            Number.isFinite(actual.start) &&
            Number.isFinite(actual.end) &&
            actual.end > actual.start
          )
            return [actual];
        }
        if (record.status === 'partial') uncertainSleeps.push(scheduled);
        return [scheduled];
      }),
  );
  return { sleeps: merge(sleeps), uncertainSleeps: merge(uncertainSleeps) };
}

/** Shared sleep bounds for meal scheduling/export: missed logs are not sleep. */
export function effectiveSleepIntervals(plan: Plan, trip: Trip): { start: number; end: number }[] {
  return resolveSleepIntervals(plan, trip).sleeps;
}

function contextFor(plan: Plan, trip: Trip): Context {
  return {
    flights: trip.legs
      .map((leg) => ({
        leg,
        start: localToInstant(
          leg.departureDateTime,
          leg.departureTimeZone,
          leg.departureDisambiguation,
        ),
        end: localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation),
        ...flightAirborneTiming(leg),
      }))
      .sort((a, b) => a.start - b.start),
    // Merge midnight splits, duplicate timezone cards and preserved sleep logs.
    // Only the generated plan determines rest; meals never alter that plan.
    ...resolveSleepIntervals(plan, trip),
  };
}

/**
 * Practical meal opportunities, not predictions of airline service or effects on
 * circadian phase. CDC advises following destination meal times when practical;
 * NHLBI advises protecting sleep and using a light snack rather than a heavy
 * meal near bedtime. The 20–30-minute windows and airport buffers are scheduling
 * conveniences, not evidence of a clinically optimal meal time or a fasting rule.
 */
function mealPlanFor(flight: Flight, context: Context, used: Range[] = []): FlightMealPlan {
  const { flights, sleeps } = context;
  const index = flights.findIndex((value) => value.leg.id === flight.leg.id);
  const previous = flights[index - 1],
    next = flights[index + 1];
  const rest = sleeps
    .map((sleep) => ({
      start: Math.max(sleep.start, flight.start),
      end: Math.min(sleep.end, flight.end),
    }))
    .filter((sleep) => sleep.end > sleep.start);
  const windows: MealWindow[] = [];
  const blocks = [...sleeps, ...used];

  const offer = (range: Range, location: MealWindow['location'], latest = false): boolean => {
    // Ground windows must not overlap any other flight. In-flight windows use
    // the same first-30/final-60-minute airborne protection as sleep planning.
    const unavailable = location === 'in-flight' ? blocks : [...blocks, ...flights];
    const available = subtract(range, unavailable);
    const piece = latest ? available.at(-1) : available[0];
    if (!piece) return false;
    const length = Math.min(MEAL, piece.end - piece.start);
    const start = latest ? piece.end - length : piece.start,
      end = start + length;
    const title =
      location === 'before-flight'
        ? 'Light meal or snack before boarding'
        : location === 'after-flight'
          ? 'Meal or light snack after arrival'
          : 'Meal or light snack while awake';
    windows.push({
      id: `meal:${flight.leg.id}:${location}:${start}`,
      start: iso(start),
      end: iso(end),
      location,
      title,
      detail:
        location === 'in-flight'
          ? 'A flexible eating opportunity if food is available, not a confirmed airline service time. Keep the planned rest undisturbed; choose a light snack near sleep. Follow destination meal times when practical, without forcing yourself to fast.'
          : 'A flexible opportunity while awake, allowing time for airport formalities. Choose a light snack near planned sleep. Follow destination meal times when practical; adjust for hunger, food availability and your connection.',
    });
    blocks.push({ start, end });
    return true;
  };

  const before = () => {
    // A surface transfer has unknown practical timing; do not promise a meal in
    // a short transfer between different airports.
    if (
      previous &&
      previous.leg.arrivalAirport !== flight.leg.departureAirport &&
      flight.start - previous.end < 4 * HOUR
    )
      return false;
    return offer(
      {
        start: Math.max(flight.start - 3 * HOUR, previous ? previous.end + 45 * MINUTE : -Infinity),
        end: flight.start - HOUR,
      },
      'before-flight',
      true,
    );
  };
  const after = () => {
    // On a short connection the onward leg owns any feasible pre-boarding meal;
    // this avoids suggesting two meals in the same small airport gap.
    if (next && next.start - flight.end < 4 * HOUR) return false;
    return offer(
      {
        start: flight.end + 45 * MINUTE,
        end: Math.min(flight.end + 3 * HOUR, next ? next.start - HOUR : Infinity),
      },
      'after-flight',
    );
  };
  const airborne = { start: flight.takeoff + 30 * MINUTE, end: flight.landing - 60 * MINUTE };

  if (rest.length) {
    before();
    const lastRest = rest.at(-1)!;
    // Prefer eating after rest. Never shorten sleep for breakfast or create a
    // meal inside the protected approach interval just because landing is near.
    const ateAfterRest = offer(
      { start: Math.max(airborne.start, lastRest.end), end: airborne.end },
      'in-flight',
    );
    if (!ateAfterRest) {
      const firstRest = rest[0];
      const earliest = Math.max(
        airborne.start,
        windows.length ? Date.parse(windows.at(-1)!.end) + 3 * HOUR : airborne.start,
      );
      const beforeRestEnd = Math.min(firstRest.start, airborne.end);
      if (beforeRestEnd - earliest >= 90 * MINUTE)
        offer({ start: earliest, end: beforeRestEnd }, 'in-flight');
    }
    const lastMeal = windows.at(-1);
    if (!ateAfterRest || !lastMeal || flight.end - Date.parse(lastMeal.end) >= 4 * HOUR) after();
  } else {
    const ateInFlight = offer(airborne, 'in-flight');
    if (ateInFlight && flight.end - flight.start >= 8 * HOUR) {
      offer({ start: Date.parse(windows[0].end) + 4 * HOUR, end: airborne.end }, 'in-flight');
    }
    if (!ateInFlight && !before()) after();
  }

  const uncertainty = context.uncertainSleeps.some(
    (sleep) => sleep.start < flight.end + 3 * HOUR && sleep.end > flight.start - 3 * HOUR,
  )
    ? ' A partial sleep log has no actual times; its scheduled interval is protected as an uncertain rest buffer.'
    : '';
  return {
    wakeForMeals: rest.length === 0,
    advice: rest.length ? 'Let me sleep through meal service' : 'Meal service can fit while awake',
    reason: rest.length
      ? 'Ask the crew not to wake you during the planned rest. Protecting sleep takes priority over meal service; eat while awake before or after it. These are flexible suggestions, not confirmed service times.' +
        uncertainty
      : 'No in-flight rest is planned on this leg. Eat if a meal is offered while you are awake; a short flight may be easier to plan around a ground meal or snack. Service times and food availability are unknown.' +
        uncertainty,
    ...(rest.length ? { sleepStart: iso(rest[0].start), sleepEnd: iso(rest.at(-1)!.end) } : {}),
    windows: windows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  };
}

/** Public helper for one flight; all itinerary sleep and connection constraints apply. */
export function buildFlightMealPlan(plan: Plan, trip: Trip, leg: FlightLeg): FlightMealPlan {
  const context = contextFor(plan, trip);
  const flight = context.flights.find((value) => value.leg.id === leg.id);
  if (!flight) throw new RangeError('Flight must belong to this itinerary.');
  return mealPlanFor(flight, context);
}

/** Attach meal metadata without changing actions, clinical estimates or model inputs. */
export function decoratePlanWithMeals(plan: Plan, trip: Trip): Plan {
  const context = contextFor(plan, trip),
    meals = new Map<string, FlightMealPlan>(),
    used: Range[] = [];
  for (const flight of context.flights) {
    const mealPlan = mealPlanFor(flight, context, used);
    meals.set(flight.leg.id, mealPlan);
    used.push(
      ...mealPlan.windows.map((window) => ({
        start: Date.parse(window.start),
        end: Date.parse(window.end),
      })),
    );
  }
  return {
    ...plan,
    days: plan.days.map((day) =>
      day.travelSegments?.length
        ? {
            ...day,
            travelSegments: day.travelSegments.map((segment) => ({
              ...segment,
              mealPlan: meals.get(segment.id),
            })),
          }
        : day,
    ),
  };
}
