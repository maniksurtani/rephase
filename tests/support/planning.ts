import { generatePlan as plan } from '../../src/lib/plan';
import {
  generateModelPlan as model,
  generateModelPlanWithDiagnostics as diagnostics,
  type ModelPlanOptions,
} from '../../src/lib/model-plan';
import { createPlanningContext } from '../../src/lib/planning-airports';
import type { Preferences, Trip } from '../../src/lib/types';

/** Exercise the same catalog-to-planner boundary as the app without repeating setup in each scenario. */
function optionsFor(trip: Trip, options: Partial<ModelPlanOptions> = {}): ModelPlanOptions {
  return { context: createPlanningContext(trip), ...options };
}

export function generatePlan(
  trip: Trip,
  preferences: Preferences,
  options?: Partial<ModelPlanOptions>,
) {
  return plan(trip, preferences, optionsFor(trip, options));
}

export function generateModelPlan(
  trip: Trip,
  preferences: Preferences,
  options?: Partial<ModelPlanOptions>,
) {
  return model(trip, preferences, optionsFor(trip, options));
}

export function generateModelPlanWithDiagnostics(
  trip: Trip,
  preferences: Preferences,
  options?: Partial<ModelPlanOptions>,
) {
  return diagnostics(trip, preferences, optionsFor(trip, options));
}
