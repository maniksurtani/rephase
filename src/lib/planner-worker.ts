import { generatePlan } from './plan';
import type { Plan, Preferences, Trip } from './types';
import type { PlanningContext } from './planning-context';

export interface PlannerRequest {
  id: string;
  trip: Trip;
  preferences: Preferences;
  context: PlanningContext;
  now?: number;
}
export type PlannerResponse = { id: string; plan: Plan } | { id: string; error: string };

/** Dedicated browser worker: callers correlate replies by id and ignore obsolete requests. */
self.addEventListener('message', (event: MessageEvent<PlannerRequest>) => {
  const request = event.data;
  try {
    const response: PlannerResponse = {
      id: request.id,
      plan: generatePlan(request.trip, request.preferences, {
        now: request.now,
        context: request.context,
      }),
    };
    self.postMessage(response);
  } catch (error) {
    const response: PlannerResponse = {
      id: request.id,
      error:
        error instanceof Error
          ? error.message
          : 'Planning failed. Review the itinerary and try again.',
    };
    self.postMessage(response);
  }
});
