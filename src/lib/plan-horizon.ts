import { Temporal } from '@js-temporal/polyfill';
import { localToInstant } from './time';
import type { Plan, PlanAction, Trip } from './types';

/** Keep arrival day and the following local day, including DST's real midnight. */
export function arrivalPlanHorizon(arrival: number, timeZone: string) {
  const arrivalDate = Temporal.Instant.fromEpochMilliseconds(arrival)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
  return {
    lastDate: arrivalDate.add({ days: 1 }).toString(),
    end: arrivalDate.add({ days: 2 }).toZonedDateTime(timeZone).epochMilliseconds,
  };
}

const actionKey = (action: PlanAction) => `${action.id}:${action.start}:${action.end}`;

/**
 * Limit the published plan after simulation, so its optimization horizon stays
 * unchanged. The final bedtime keeps its original next-morning fragments as
 * episode context without creating another date tile or another night's advice.
 */
export function limitPlanToArrival(plan: Plan, trip: Trip): Plan {
  const arrivals = trip.legs.map((leg) => ({
    time: localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation),
    zone: leg.arrivalTimeZone,
  }));
  const last = arrivals.sort((a, b) => b.time - a.time)[0];
  if (!last) return plan;
  const horizon = arrivalPlanHorizon(last.time, last.zone);
  const actions = [
    ...new Map(
      plan.days.flatMap((day) => day.actions.map((action) => [actionKey(action), action])),
    ).values(),
  ];
  const retainedSleep = actions.filter(
    (action) => action.type === 'sleep' && Date.parse(action.start) < horizon.end,
  );
  const continuation: PlanAction[] = [];
  for (const action of actions
    .filter((action) => action.type === 'sleep' && Date.parse(action.start) >= horizon.end)
    .sort((a, b) => a.start.localeCompare(b.start))) {
    const boundary = Temporal.Instant.from(action.start).toZonedDateTimeISO(action.timeZone);
    if (
      boundary.hour === 0 &&
      boundary.minute === 0 &&
      boundary.second === 0 &&
      boundary.millisecond === 0 &&
      [...retainedSleep, ...continuation].some(
        (previous) =>
          previous.end === action.start &&
          previous.timeZone === action.timeZone &&
          previous.sleepKind === action.sleepKind &&
          previous.origin === action.origin &&
          previous.title === action.title,
      )
    )
      continuation.push(action);
  }
  const days = plan.days
    .filter(
      (day) =>
        day.date <= horizon.lastDate &&
        Temporal.PlainDate.from(day.date).toZonedDateTime(day.timeZone).epochMilliseconds <
          horizon.end,
    )
    .map((day) => ({
      ...day,
      actions: day.actions.filter((action) => Date.parse(action.start) < horizon.end),
    }));
  const finalDay =
    days.find((day) => day.date === horizon.lastDate && day.timeZone === last.zone) ?? days.at(-1);
  if (finalDay && continuation.length)
    finalDay.actions = [...finalDay.actions, ...continuation].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
  return { ...plan, days };
}
