import { useMemo } from 'react';
import type { Plan, PlanTravelSegment, Trip } from './types';
import { groupPlanDays } from './plan-calendar';
import { selectPlanTiming } from './plan-view';

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
  const timing = useMemo(
    () => selectPlanTiming(calendarDays, allActions, flights, selectedDayId, now),
    [calendarDays, allActions, flights, selectedDayId, now],
  );
  return { calendarDays, ...timing, isDemo: trip?.id.startsWith('demo-') ?? false };
}

export type PlanViewState = ReturnType<typeof usePlanView>;
