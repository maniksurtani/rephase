import type { PlanCalendarDay } from './plan-calendar';
import { isCalendarDayCurrent } from './plan-calendar';
import { localDate } from './display';
import type { PlanAction, PlanTravelSegment } from './types';

/** Use absolute device time, not a date string, across destination clocks. */
export function selectPlanTiming(
  calendarDays: PlanCalendarDay[],
  allActions: PlanAction[],
  flights: PlanTravelSegment[],
  selectedDayId: string | null,
  now: Date,
) {
  const currentAction = allActions.find(
    (a) => Date.parse(a.start) <= now.getTime() && Date.parse(a.end) > now.getTime(),
  );
  const nextAction = allActions.find((a) => Date.parse(a.start) > now.getTime());
  const currentFlight = flights.find(
    (flight) =>
      Date.parse(flight.departure) <= now.getTime() && Date.parse(flight.arrival) > now.getTime(),
  );
  const nextFlight = flights.find((flight) => Date.parse(flight.departure) > now.getTime());
  const flightDay = (flight: PlanTravelSegment) => {
    const date =
      currentFlight?.id === flight.id
        ? localDate(now, flight.arrivalTimeZone)
        : localDate(flight.departure, flight.departureTimeZone);
    return (
      calendarDays.find(
        (day) =>
          day.date === date && day.travelSegments.some((segment) => segment.id === flight.id),
      ) ??
      calendarDays.find((day) => day.travelSegments.some((segment) => segment.id === flight.id))
    );
  };
  const currentDay =
    calendarDays.find(
      (day) =>
        currentAction &&
        day.date === localDate(now, currentAction.timeZone) &&
        day.actions.some((action) => action.id === currentAction.id),
    ) ?? (currentFlight ? flightDay(currentFlight) : undefined);
  const nextDay =
    nextFlight && (!nextAction || Date.parse(nextFlight.departure) < Date.parse(nextAction.start))
      ? flightDay(nextFlight)
      : calendarDays.find((day) => day.actions.some((action) => action.id === nextAction?.id));
  const today =
    currentDay ??
    (nextDay && isCalendarDayCurrent(nextDay, now.getTime())
      ? nextDay
      : calendarDays.filter((day) => isCalendarDayCurrent(day, now.getTime())).at(-1));
  const upcomingDay = currentDay ?? nextDay ?? (currentAction || currentFlight ? today : undefined);
  const defaultDay = today ?? upcomingDay ?? calendarDays[0];
  const selectedDay = calendarDays.find((day) => day.id === selectedDayId) ?? defaultDay;
  const timelineDay = today ?? upcomingDay;
  const itineraryFinished = Boolean(calendarDays.length && !upcomingDay);

  return { currentAction, nextAction, today, timelineDay, itineraryFinished, selectedDay };
}

/** Past guidance stays in the full plan; previews retain ongoing original objects. */
export function todayPreview(
  day: PlanCalendarDay,
  now: number,
  calendarDays: readonly PlanCalendarDay[] = [],
) {
  const pending = (source: PlanCalendarDay) =>
    source.actions
      .filter((action) => Date.parse(action.end) > now)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  let actionDay = day;
  let actions = pending(day);
  if (!actions.length) {
    const next = calendarDays
      .filter((source) => source.id !== day.id)
      .map((source) => ({ source, actions: pending(source) }))
      .filter((candidate) => candidate.actions.length)
      .sort((a, b) => Date.parse(a.actions[0].start) - Date.parse(b.actions[0].start))[0];
    if (next) {
      actionDay = next.source;
      actions = next.actions;
    }
  }
  return {
    actionDay,
    actions: actions.slice(0, 3),
    flights: day.travelSegments
      .filter((flight) => Date.parse(flight.arrival) > now)
      .sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure)),
  };
}
