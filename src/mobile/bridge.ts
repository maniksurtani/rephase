import { Temporal } from '@js-temporal/polyfill';
import { AIRPORTS, findAirport } from '../lib/airports';
import { createDemoTrip, createEmptyTrip, createLeg, DEFAULT_PREFERENCES } from '../lib/defaults';
import { buildDayTimeline, timelineTimeZone } from '../lib/day-timeline';
import { phaseChangeLabel, remainingAdjustmentLabel } from '../lib/display';
import { buildCalendar } from '../lib/export';
import { validateTrip } from '../lib/itinerary';
import { evaluateAirportLounges } from '../lib/lounge-access';
import { LOUNGE_AIRLINES, LOUNGE_DATA, loungeDataFor } from '../lib/lounge-data';
import { LOYALTY_PROGRAMS } from '../lib/lounge-programs';
import { LOUNGE_MEMBERSHIPS } from '../lib/lounge-types';
import type { LoungeVisitContext } from '../lib/lounge-types';
import { airportCountry, buildFlightLoungeContexts } from '../lib/lounge-windows';
import type { LoungeFlightContext } from '../lib/lounge-windows';
import { mergeAppData } from '../lib/merge';
import { generatePlan } from '../lib/plan';
import { groupPlanDays, isCalendarDayCurrent } from '../lib/plan-calendar';
import { actionCity, planDayCity } from '../lib/plan-places';
import { selectPlanTiming, todayPreview } from '../lib/plan-view';
import { createPlanningContext } from '../lib/planning-airports';
import { localToInstant } from '../lib/time';
import { searchTimeZones } from '../lib/time-zones';
import { buildTimelineSteps } from '../lib/timeline-steps';
import { actionTravelSegment, travelClock } from '../lib/travel-clocks';
import type { AppData, Plan, PlanAction, PlanTravelSegment, Preferences, Trip } from '../lib/types';
import { validateAppData } from '../lib/validation';

type Payload = Record<string, unknown>;
const iso = (epoch: number) => new Date(epoch).toISOString();
const nowFrom = (payload: Payload) => (typeof payload.now === 'number' ? payload.now : Date.now());

function presentPlan(plan: Plan, trip: Trip, now: number) {
  const grouped = groupPlanDays(plan.days);
  const loungeContexts = buildFlightLoungeContexts(trip);
  const action = (value: PlanAction) => ({
    ...value,
    city: actionCity(value, plan.days),
    clock: travelClock(value.start, value.timeZone),
    endClock: travelClock(value.end, value.timeZone),
  });
  const flight = (value: PlanTravelSegment) => ({
    ...value,
    departureCity: findAirport(value.departureAirport)?.city ?? 'Departure city',
    arrivalCity: findAirport(value.arrivalAirport)?.city ?? 'Destination',
    departureClock: travelClock(value.departure, value.departureTimeZone),
    arrivalClock: travelClock(value.arrival, value.arrivalTimeZone),
    departureClocks: [
      { airport: value.departureAirport, ...travelClock(value.departure, value.departureTimeZone) },
      { airport: value.arrivalAirport, ...travelClock(value.departure, value.arrivalTimeZone) },
    ],
    arrivalClocks: [
      { airport: value.departureAirport, ...travelClock(value.arrival, value.departureTimeZone) },
      { airport: value.arrivalAirport, ...travelClock(value.arrival, value.arrivalTimeZone) },
    ],
    mealPlan: value.mealPlan && {
      ...value.mealPlan,
      windows: value.mealPlan.windows.map((meal) => ({
        ...meal,
        clock: travelClock(
          meal.start,
          meal.location === 'after-flight' ? value.arrivalTimeZone : value.departureTimeZone,
        ),
        endClock: travelClock(
          meal.end,
          meal.location === 'after-flight' ? value.arrivalTimeZone : value.departureTimeZone,
        ),
      })),
    },
  });
  const days = grouped.map((day) => {
    const timeline = buildDayTimeline(day, { loungeContexts });
    // Shared action history belongs to the planning boundary, not every JSON day.
    const publicDay = { ...day };
    delete publicDay.allActions;
    const enrichEntry = (entry: (typeof timeline.entries)[number]) => ({
      ...entry,
      ...(entry.kind === 'action'
        ? { action: action(entry.action) }
        : entry.kind === 'flight'
          ? { flight: flight(entry.flight) }
          : {}),
    });
    return {
      ...publicDay,
      city: planDayCity(day),
      phaseChangeLabel:
        day.phaseEstimateAvailable === false
          ? 'Unavailable'
          : phaseChangeLabel(day.phaseShiftHours),
      remainingAdjustmentLabel:
        day.phaseEstimateAvailable === false
          ? 'Unavailable'
          : remainingAdjustmentLabel(day.remainingShiftHours),
      actions: day.actions.map(action),
      travelSegments: day.travelSegments.map(flight),
      timeline: { ...timeline, entries: timeline.entries.map(enrichEntry) },
      steps: buildTimelineSteps(timeline).map((step) => {
        const relevantFlight = actionTravelSegment(
          { start: iso(step.start), end: iso(step.end) } as PlanAction,
          day.travelSegments,
        );
        const clockChange = timeline.clockChanges?.find(
          (change) => change.at === step.start && change.fromTimeZone,
        );
        return {
          ...step,
          entries: step.entries.map(enrichEntry),
          clock: travelClock(iso(step.start), timelineTimeZone(timeline, step.start)),
          endClock: travelClock(iso(step.end), timelineTimeZone(timeline, step.end, true)),
          clockChange: clockChange && {
            ...clockChange,
            city: clockChange.locationAirport
              ? findAirport(clockChange.locationAirport)?.city
              : undefined,
            fromClock: travelClock(iso(step.start), clockChange.fromTimeZone!),
            toClock: travelClock(iso(step.start), clockChange.timeZone),
          },
          dualClocks:
            relevantFlight && relevantFlight.departureTimeZone !== relevantFlight.arrivalTimeZone
              ? [
                  {
                    airport: relevantFlight.departureAirport,
                    ...travelClock(iso(step.start), relevantFlight.departureTimeZone),
                  },
                  {
                    airport: relevantFlight.arrivalAirport,
                    ...travelClock(iso(step.start), relevantFlight.arrivalTimeZone),
                  },
                ]
              : [],
        };
      }),
      lastClock: travelClock(iso(timeline.end), timelineTimeZone(timeline, timeline.end, true)),
    };
  });
  const actions = [
    ...new Map(
      grouped.flatMap((day) =>
        day.actions.map((item) => [`${item.id}:${item.start}:${item.end}`, item] as const),
      ),
    ).values(),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const flights = [
    ...new Map(
      grouped.flatMap((day) => day.travelSegments.map((item) => [item.id, item] as const)),
    ).values(),
  ].sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  const timing = selectPlanTiming(grouped, actions, flights, null, new Date(now));
  const preview = timing.timelineDay ? todayPreview(timing.timelineDay, now, grouped) : undefined;
  return {
    plan,
    days,
    loungeContexts,
    today: {
      currentAction: timing.currentAction ? action(timing.currentAction) : null,
      nextAction: timing.nextAction ? action(timing.nextAction) : null,
      previewActions: preview?.actions.map(action) ?? [],
      previewFlights: preview?.flights.map(flight) ?? [],
      dayId: timing.timelineDay?.id ?? null,
      actionDate: preview?.actionDay.date ?? null,
      actionCity: preview ? planDayCity(preview.actionDay) : null,
      itineraryFinished: timing.itineraryFinished,
      isCurrentDay: Boolean(timing.timelineDay && isCalendarDayCurrent(timing.timelineDay, now)),
    },
  };
}

function localParts(value: string, zone: string) {
  const local = Temporal.Instant.from(value).toZonedDateTimeISO(zone);
  const date = local.toPlainDate().toString(),
    time = local.toPlainTime().toString({ smallestUnit: 'minute' });
  const text = `${date}T${time}`;
  const earlier = localToInstant(text, zone, 'earlier'),
    later = localToInstant(text, zone, 'later');
  return {
    date,
    time,
    choice:
      earlier === later
        ? undefined
        : Date.parse(value) >= later
          ? ('later' as const)
          : ('earlier' as const),
  };
}

function loungeVisit(payload: Payload) {
  const context = payload.flightContext as LoungeFlightContext | undefined;
  const airport = String(payload.airport ?? context?.airport ?? 'SFO').toUpperCase();
  const data = loungeDataFor(airport);
  const zone = data?.timeZone ?? findAirport(airport)?.timeZone;
  if (!zone) throw new RangeError('Choose an airport with a known time zone.');
  const first = context
    ? localParts(context.start ?? context.departure, zone)
    : {
        date: Temporal.Instant.fromEpochMilliseconds(nowFrom(payload))
          .toZonedDateTimeISO(zone)
          .toPlainDate()
          .toString(),
        time: '10:00',
        choice: undefined,
      };
  const last = context?.end ? localParts(context.end, zone) : undefined;
  const departure = context ? localParts(context.departure, zone) : undefined;
  const originCountry = airportCountry(airport),
    destinationCountry = airportCountry(context?.destinationAirport ?? '');
  return {
    airport,
    timeZone: zone,
    airportData: data ?? null,
    date: first.date,
    from: context && !context.start ? '' : first.time,
    until: last?.time ?? (context ? '' : '12:00'),
    departureTime: departure?.time ?? '13:00',
    fromChoice: first.choice,
    untilChoice: last?.choice,
    departureChoice: departure?.choice,
    terminals: [...new Set(data?.lounges.map((item) => item.terminal) ?? [])],
    route: originCountry && originCountry === destinationCountry ? 'domestic' : 'international',
    destinationCountry,
    marketingCarrier:
      context?.flightNumber.replace(/\s/g, '').match(/^([A-Z0-9]{2})(?=\d)/)?.[1] ?? '',
    cabin: context?.travelClass ?? 'economy',
  };
}

function lounges(payload: Payload) {
  const initial = loungeVisit(payload);
  const data = initial.airportData;
  if (!data)
    return {
      ...initial,
      results: [],
      recommendedId: null,
      context: null,
      error: 'No lounge guide is available for this airport yet.',
    };
  try {
    let context = payload.context as LoungeVisitContext | undefined;
    if (!context) {
      const preferences = (payload.preferences ?? DEFAULT_PREFERENCES) as Preferences;
      const original = payload.flightContext as LoungeFlightContext | undefined;
      const date = String(payload.date ?? initial.date),
        from = String(payload.from ?? initial.from),
        until = String(payload.until ?? initial.until);
      const departureTime = String(payload.departureTime ?? initial.departureTime);
      if (!from || !until || !departureTime)
        throw new RangeError('Choose a complete lounge visit and departure time.');
      const nextDate = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
      const resolve = (
        clock: string,
        choice: unknown,
        originalInstant?: string,
        rollsOver = false,
      ) => {
        const parts = originalInstant ? localParts(originalInstant, initial.timeZone) : undefined;
        const endDate =
          parts && date === initial.date && clock === parts.time
            ? parts.date
            : rollsOver
              ? nextDate
              : date;
        const local = `${endDate}T${clock}`;
        const fold = choice as 'earlier' | 'later' | undefined;
        if (
          originalInstant &&
          parts &&
          `${parts.date}T${parts.time}` === local &&
          fold === parts.choice
        )
          return originalInstant;
        return iso(localToInstant(local, initial.timeZone, fold));
      };
      context = {
        memberships: preferences.loungeMemberships ?? [],
        priority: preferences.loungePriority ?? 'balanced',
        cabin: (payload.cabin ?? initial.cabin) as LoungeVisitContext['cabin'],
        marketingCarrier: String(payload.marketingCarrier ?? initial.marketingCarrier) || undefined,
        operatingCarrier: String(payload.operatingCarrier ?? '') || undefined,
        terminal: String(payload.terminal ?? '') || undefined,
        route: (payload.route ?? initial.route) as LoungeVisitContext['route'],
        destinationCountry:
          String(payload.destinationCountry ?? initial.destinationCountry ?? '') || undefined,
        visitStart: resolve(from, payload.fromChoice, original?.start),
        visitEnd: resolve(until, payload.untilChoice, original?.end, until <= from),
        departure: resolve(
          departureTime,
          payload.departureChoice,
          original?.departure,
          departureTime < from,
        ),
        now: iso(nowFrom(payload)),
      };
    }
    const duration = Date.parse(context.visitEnd) - Date.parse(context.visitStart);
    if (!(duration > 0))
      throw new RangeError(
        'Finish your visit after it starts. Check the date and any repeated clock times.',
      );
    if (duration > 12 * 3_600_000)
      throw new RangeError(
        'Choose a visit of 12 hours or less. An earlier end time means the following day.',
      );
    if (
      context.departure &&
      Date.parse(context.visitEnd) > Date.parse(context.departure) - 30 * 60_000
    )
      throw new RangeError('Finish your lounge visit at least 30 minutes before departure.');
    return { ...initial, ...evaluateAirportLounges(data, context), context, error: null };
  } catch (error) {
    return {
      ...initial,
      results: [],
      recommendedId: null,
      context: null,
      error: error instanceof Error ? error.message : 'Check the lounge visit times.',
    };
  }
}

/** JSON-only boundary: native UI never loads a website or executes downloaded code. */
export function call(operation: string, payload: Payload = {}): Record<string, unknown> {
  switch (operation) {
    case 'bootstrap':
      return {
        protocolVersion: 1,
        defaultPreferences: DEFAULT_PREFERENCES,
        demoTrip: createDemoTrip(),
        airports: AIRPORTS,
        timeZones: [...new Set(['UTC', ...AIRPORTS.map((airport) => airport.timeZone)])]
          .sort()
          .map((value) => ({ value, city: value.split('/').at(-1)!.replaceAll('_', ' ') })),
        loyaltyPrograms: LOYALTY_PROGRAMS,
        memberships: LOUNGE_MEMBERSHIPS,
        loungeAirports: LOUNGE_DATA.map(({ airport, timeZone, updatedAt }) => ({
          airport,
          timeZone,
          updatedAt,
        })),
        airlines: LOUNGE_AIRLINES,
      };
    case 'newTrip':
      return { trip: createEmptyTrip() };
    case 'newLeg':
      return { leg: createLeg() };
    case 'plan': {
      const trip = payload.trip as Trip,
        preferences = payload.preferences as Preferences;
      const now = nowFrom(payload);
      return presentPlan(
        generatePlan(trip, preferences, { now, context: createPlanningContext(trip) }),
        trip,
        now,
      );
    }
    case 'view':
      return presentPlan(payload.plan as Plan, payload.trip as Trip, nowFrom(payload));
    case 'validateData': {
      const error = validateAppData(payload.data);
      return { valid: error === null, error };
    }
    case 'validateTrip': {
      const errors = validateTrip(payload.trip as Trip);
      return { valid: errors.length === 0, errors };
    }
    case 'merge': {
      for (const value of [payload.base, payload.local, payload.remote]) {
        const error = validateAppData(value);
        if (error) throw new RangeError(error);
      }
      return {
        ...mergeAppData(
          payload.base as AppData,
          payload.local as AppData,
          payload.remote as AppData,
        ),
      };
    }
    case 'searchTimeZones':
      return {
        results: searchTimeZones(
          String(payload.query ?? ''),
          typeof payload.limit === 'number' ? payload.limit : 8,
        ),
      };
    case 'localTime': {
      try {
        const value = String(payload.dateTime),
          zone = String(payload.timeZone);
        const ambiguous =
          localToInstant(value, zone, 'earlier') !== localToInstant(value, zone, 'later');
        const epochMs = localToInstant(
          value,
          zone,
          payload.disambiguation as 'earlier' | 'later' | undefined,
        );
        return { valid: true, epochMs, iso: iso(epochMs), ambiguous };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Check the local date, time and time zone.';
        return { valid: false, ambiguous: message.includes('occurs twice'), error: message };
      }
    }
    case 'clock': {
      const instant =
        typeof payload.instant === 'number' ? iso(payload.instant) : String(payload.instant);
      const zone = String(payload.timeZone);
      const local = localParts(instant, zone);
      return {
        ...travelClock(instant, zone),
        localDateTime: `${local.date}T${local.time}`,
        choice: local.choice,
      };
    }
    case 'lounges':
      return lounges(payload);
    case 'loungeVisit':
      return loungeVisit(payload);
    case 'calendar':
      return {
        contents: buildCalendar(
          payload.plan as Plan,
          payload.trip as Trip,
          payload.withAlarms !== false,
        ),
        filename: 'rephase-plan.ics',
        mime: 'text/calendar',
      };
    default:
      throw new RangeError(`Unsupported mobile engine operation: ${operation}`);
  }
}

export function invoke(operation: string, payload: Payload = {}) {
  try {
    return { ok: true, result: call(operation, payload) };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The offline planner could not complete this request.',
    };
  }
}
