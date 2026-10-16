import { useMemo } from 'react';
import type { Plan, PlanTravelSegment, Trip } from './types';
import { groupPlanDays, isCalendarDayCurrent } from './plan-calendar';
import { localDate } from './display';

/** Presentation grouping stays stable while unrelated editors and menus change. */
export function usePlanView(
  plan: Plan | null,
  trip: Trip | null,
  selectedDayId: string | null,
  now: Date,
) {
  const calendarDays = useMemo(() => groupPlanDays(plan?.days ?? []), [plan]);
  const allActions = useMemo(
    () =>
      calendarDays
        .flatMap((day) => day.actions)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    [calendarDays],
  );
  const flights = useMemo(
    () =>
      [
        ...new Map(
          calendarDays.flatMap((day) =>
            day.travelSegments.map((segment) => [segment.id, segment] as const),
          ),
        ).values(),
      ].sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure)),
    [calendarDays],
  );
  const timing = useMemo(() => {
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
      calendarDays.find((day) => day.actions.some((action) => action.id === currentAction?.id)) ??
      (currentFlight ? flightDay(currentFlight) : undefined);
    const nextDay =
      nextFlight && (!nextAction || Date.parse(nextFlight.departure) < Date.parse(nextAction.start))
        ? flightDay(nextFlight)
        : calendarDays.find((day) => day.actions.some((action) => action.id === nextAction?.id));
    const today =
      currentDay ??
      (nextDay && isCalendarDayCurrent(nextDay, now.getTime())
        ? nextDay
        : calendarDays.filter((day) => isCalendarDayCurrent(day, now.getTime())).at(-1));
    const upcomingDay = currentDay ?? nextDay;
    const defaultDay = today ?? upcomingDay ?? calendarDays[0];
    const selectedDay = calendarDays.find((day) => day.id === selectedDayId) ?? defaultDay;
    const timelineDay = today ?? upcomingDay;
    const itineraryFinished = Boolean(calendarDays.length && !upcomingDay);

    return { currentAction, nextAction, today, timelineDay, itineraryFinished, selectedDay };
  }, [calendarDays, allActions, flights, selectedDayId, now]);
  return { calendarDays, ...timing, isDemo: trip?.id.startsWith('demo-') ?? false };
}

export type PlanViewState = ReturnType<typeof usePlanView>;
