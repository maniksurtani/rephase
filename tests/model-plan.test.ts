import { describe, expect, it } from 'vitest';
import { generatePlan, flightAirborneTiming, validateTrip } from '../src/lib/plan';
import { generateModelPlanWithDiagnostics, MODEL_PLAN_VERSION } from '../src/lib/model-plan';
import { localToInstant } from '../src/lib/time';
import type { FlightLeg, Preferences, Trip } from '../src/lib/types';
const HOUR = 3_600_000, DAY = 24 * HOUR;
const prefs: Preferences = { homeTimeZone: 'America/New_York', chronotype: 'intermediate', usualBedtime: '23:00', usualWakeTime: '07:00', preferredBedtime: '23:00', preferredWakeTime: '07:00', sleepHours: 8, sleepAnchor: 'wake', caffeine: true, melatonin: false, melatoninAcknowledged: false, preparationDays: 3 };
const leg: FlightLeg = { id: 'out', flightNumber: 'BA178', departureAirport: 'JFK', arrivalAirport: 'LHR', departureDateTime: '2026-10-14T18:00', arrivalDateTime: '2026-10-15T06:00', departureTimeZone: 'America/New_York', arrivalTimeZone: 'Europe/London', stayAfter: 'destination', strategy: 'adapt', travelClass: 'economy', lieFlat: false };
const trip = (legs: FlightLeg[] = [leg]): Trip => ({ id: 'model-test', name: 'Research prototype', legs, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' });
const all = (plan: ReturnType<typeof generatePlan>) => plan.days.flatMap(day => day.actions);
const overlaps = (a: { start: string; end: string }, start: number, end: number) => Date.parse(a.start) < end && Date.parse(a.end) > start;

describe('light-driven itinerary model', () => {
  it('defaults to the numerical model and retains an explicit rules fallback', () => {
    const model = generatePlan(trip(), prefs);
    expect(model.version).toBe(MODEL_PLAN_VERSION);
    expect(model.model).toMatchObject({ name: 'Forger99', numericallyVerified: true, clinicallyValidated: false });
    expect(model.warnings.join(' ')).toContain('not a clinically validated');
    expect(generatePlan(trip(), { ...prefs, planningMode: 'rules' }).model).toBeUndefined();
    expect(model.days.every(day => Number.isFinite(day.phaseShiftHours) && Number.isFinite(day.remainingShiftHours))).toBe(true);
    expect(new Set(all(model).map(action => action.id)).size).toBe(all(model).length);
  }, 30_000);
  it('simulates both directional routes and retains alternatives across stops', () => {
    const returnLeg = { ...leg, id: 'return', departureAirport: 'LHR', arrivalAirport: 'JFK', departureDateTime: '2026-10-19T12:00', arrivalDateTime: '2026-10-19T15:00', departureTimeZone: 'Europe/London', arrivalTimeZone: 'America/New_York' };
    const { plan, diagnostics } = generateModelPlanWithDiagnostics(trip([leg, returnLeg]), prefs);
    expect(diagnostics.evaluatedCandidates).toBeGreaterThanOrEqual(10);
    expect(diagnostics.finalists.length).toBe(3);
    expect(diagnostics.finalists.some(candidate => candidate.directions.includes('advance'))).toBe(true);
    expect(diagnostics.finalists.some(candidate => candidate.directions.includes('delay'))).toBe(true);
    expect(diagnostics.selectedDirections.length).toBe(3); // Preparation, destination, then home.
    expect(diagnostics.finalists[0].score).toBeLessThanOrEqual(diagnostics.finalists[1].score);
    expect(plan.model!.assumptions.join(' ')).toContain('beam width 3');
    expect(plan.days.find(day => day.stage === 'home')).toBeDefined();
  }, 30_000);
  it('protects airborne buffers separately from gate times and preserves ground transfers', () => {
    const first = { ...leg, stayAfter: 'connection' as const, takeoffDateTime: '2026-10-14T18:40', landingDateTime: '2026-10-15T05:40' };
    const next = { ...leg, id: 'next', departureAirport: 'LHR', arrivalAirport: 'CDG', departureDateTime: '2026-10-15T08:00', arrivalDateTime: '2026-10-15T10:20', departureTimeZone: 'Europe/London', arrivalTimeZone: 'Europe/Paris' };
    const itinerary = trip([first, next]), plan = generatePlan(itinerary, { ...prefs, preparationDays: 0, melatonin: true, melatoninAcknowledged: false });
    for (const flight of itinerary.legs) {
      const departure = localToInstant(flight.departureDateTime, flight.departureTimeZone), arrival = localToInstant(flight.arrivalDateTime, flight.arrivalTimeZone), airborne = flightAirborneTiming(flight);
      for (const action of all(plan)) {
        expect(overlaps(action, departure - 2 * HOUR, airborne.takeoff + .5 * HOUR)).toBe(false);
        expect(overlaps(action, airborne.landing - HOUR, arrival + HOUR)).toBe(false);
      }
    }
    expect(all(plan).some(action => overlaps(action, Date.parse('2026-10-15T06:00Z'), Date.parse('2026-10-15T07:00Z')))).toBe(false);
  }, 30_000);
  it('uses conservative default taxi allowances and does not infer a bed from class', () => {
    const timing = flightAirborneTiming(leg), departure = localToInstant(leg.departureDateTime, leg.departureTimeZone), arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone);
    expect(timing).toEqual({ takeoff: departure + .5 * HOUR, landing: arrival - .5 * HOUR });
    const a = generatePlan(trip([{ ...leg, travelClass: 'economy', lieFlat: false }]), prefs);
    const b = generatePlan(trip([{ ...leg, travelClass: 'business', lieFlat: false }]), prefs);
    expect(a.days).toEqual(b.days);
    const flat = generatePlan(trip([{ ...leg, travelClass: 'first', lieFlat: true }]), prefs);
    const inFlightSleep = (plan: ReturnType<typeof generatePlan>) => all(plan).filter(action => action.type === 'sleep' && overlaps(action, departure, arrival));
    const flatSleep = inFlightSleep(flat), seatedRest = inFlightSleep(a);
    expect(flatSleep.length).toBeGreaterThan(0);
    expect(flatSleep.every(action => action.title === 'Bedtime')).toBe(true);
    expect(flat.days.map(day => day.phaseShiftHours)).toEqual(a.days.map(day => day.phaseShiftHours));
    expect(seatedRest.length).toBeGreaterThan(0);
    expect(seatedRest.every(action => action.title === 'Rest or nap')).toBe(true);
    expect(flatSleep.map(action => [action.start, action.end])).toEqual(seatedRest.map(action => [action.start, action.end]));
  }, 30_000);
  it('preserves requested elapsed sleep and keeps caffeine/light outside sleep', () => {
    const plan = generatePlan(trip(), { ...prefs, sleepHours: 8.25, usualWakeTime: '07:17', preferredWakeTime: '07:23' });
    const sleeps = all(plan).filter(action => action.type === 'sleep').sort((a, b) => a.start.localeCompare(b.start));
    let max = 0, start = 0, end = 0;
    for (const sleep of sleeps) { const a = Date.parse(sleep.start), b = Date.parse(sleep.end); if (a !== end) start = a; end = b; max = Math.max(max, end - start); }
    expect(max).toBe(8.25 * HOUR);
    for (const action of all(plan).filter(action => action.type !== 'sleep')) for (const sleep of sleeps) {
      expect(overlaps(action, Date.parse(sleep.start), Date.parse(sleep.end))).toBe(false);
      if (action.type === 'caffeine' && Date.parse(sleep.start) > Date.parse(action.start)) expect(Date.parse(action.end)).toBeLessThanOrEqual(Date.parse(sleep.start) - 8 * HOUR);
    }
  }, 30_000);
  it('keeps planned preparation bedtime changes within one hour per elapsed day', () => {
    const plan = generatePlan(trip(), prefs), firstDeparture = localToInstant(leg.departureDateTime, leg.departureTimeZone);
    const preparation = all(plan).filter(action => action.type === 'sleep' && Date.parse(action.start) < firstDeparture - 2 * HOUR).sort((a, b) => a.start.localeCompare(b.start));
    const ends = preparation.filter((action, index) => index === preparation.length - 1 || action.end !== preparation[index + 1].start).map(action => Date.parse(action.end));
    for (let i = 1; i < ends.length; i++) if (ends[i] - ends[i - 1] > 12 * HOUR) expect(Math.abs(ends[i] - ends[i - 1] - DAY)).toBeLessThanOrEqual(HOUR + 1);
    expect(plan.model!.assumptions.join(' ')).toContain('At most one hour/day');
  }, 30_000);
  it('does not insert a chronotype offset or a melatonin/caffeine phase effect', () => {
    const off = generatePlan(trip(), { ...prefs, caffeine: false, chronotype: 'early' });
    const on = generatePlan(trip(), { ...prefs, caffeine: true, chronotype: 'late', melatonin: true, melatoninAcknowledged: true });
    expect(on.days.map(day => [day.phaseShiftHours, day.remainingShiftHours])).toEqual(off.days.map(day => [day.phaseShiftHours, day.remainingShiftHours]));
    expect(on.warnings.join(' ')).toContain('±2 hours');
    expect(on.warnings.join(' ')).toContain('not a confidence interval');
    expect(on.model!.assumptions.join(' ')).toContain('No phase-shift benefit');
  }, 30_000);
  it('uses real solar feasibility and labels unknown locations conservatively', () => {
    const known = generatePlan(trip(), prefs), unknown = generatePlan(trip([{ ...leg, arrivalAirport: 'ZZZ' }]), prefs);
    expect(all(known).filter(action => action.type === 'light').every(action => !!action.feasibility)).toBe(true);
    expect(all(unknown).some(action => action.type === 'light' && action.feasibility === 'unknown')).toBe(true);
    expect(all(unknown).filter(action => action.feasibility === 'unknown').every(action => action.detail.includes('coordinates are unknown'))).toBe(true);
  }, 30_000);
  it('replays adherence only as uncertain past light and replans only the future', () => {
    const initial = generatePlan(trip(), prefs), action = all(initial).find(action => action.type === 'light' && action.start >= '2026-10-15')!;
    const cutoff = Date.parse(action.end) + HOUR;
    const record = { id: 'record', tripId: 'model-test', actionId: action.id, type: action.type, scheduledStart: action.start, scheduledEnd: action.end, timeZone: action.timeZone, status: 'completed' as const, recordedAt: new Date(cutoff).toISOString() };
    const completed = generateModelPlanWithDiagnostics({ ...trip(), adherence: [record] }, prefs, { now: cutoff });
    const missed = generateModelPlanWithDiagnostics({ ...trip(), adherence: [{ ...record, status: 'missed' }] }, prefs, { now: cutoff });
    expect(completed.diagnostics.replayedUntil).toBe(cutoff);
    expect(all(completed.plan).find(item => item.id === action.id)?.title).toContain('completed');
    expect(all(completed.plan).filter(item => item.id !== action.id).every(item => Date.parse(item.start) >= cutoff)).toBe(true);
    expect(completed.plan.warnings.join(' ')).toContain('Completion does not establish actual phase');
    expect(completed.plan.days.map(day => [day.phaseShiftHours, day.remainingShiftHours])).not.toEqual(missed.plan.days.map(day => [day.phaseShiftHours, day.remainingShiftHours]));
  }, 30_000);
  it('keeps one partial target through preparation and the destination', () => {
    const { plan, diagnostics } = generateModelPlanWithDiagnostics(trip([{ ...leg, strategy: 'partial' }]), prefs);
    const references = diagnostics.partialTargetReferences[leg.id];
    expect(references.length).toBeGreaterThan(4);
    expect(new Set(references.map(reference => reference.targetHours)).size).toBe(1);
    expect(references[0].targetHours).toBe(diagnostics.partialTargets[leg.id]);
    expect(plan.days.some(day => day.stage === 'preparation')).toBe(true);
    expect(plan.days.some(day => day.stage === 'destination')).toBe(true);
    expect(plan.model!.assumptions.join(' ')).toContain('established once per stay');
  }, 30_000);
  it('uses actual usual bedtime/wake duration for baseline independently of required sleep', () => {
    const seven = generateModelPlanWithDiagnostics(trip(), { ...prefs, usualBedtime: '23:00', usualWakeTime: '06:00', sleepHours: 8 });
    const eight = generateModelPlanWithDiagnostics(trip(), { ...prefs, usualBedtime: '22:00', usualWakeTime: '06:00', sleepHours: 8 });
    expect(seven.diagnostics.finalists.map(candidate => candidate.score)).not.toEqual(eight.diagnostics.finalists.map(candidate => candidate.score));
    expect(seven.plan.model!.assumptions.join(' ')).toContain('duration (7 hours)');
    expect(seven.plan.warnings.join(' ')).toContain('separate from your requested 8 hours');
    const sleeps = all(seven.plan).filter(action => action.type === 'sleep').sort((a,b) => a.start.localeCompare(b.start));
    let longest = 0, start = 0, end = 0;
    for (const sleep of sleeps) { const a = Date.parse(sleep.start), b = Date.parse(sleep.end); if (a !== end) start = a; end = b; longest = Math.max(longest, end - start); }
    expect(longest).toBe(8 * HOUR);
    const invalidHabit = generatePlan(trip(), { ...prefs, usualBedtime: '06:00', usualWakeTime: '06:00' });
    expect(invalidHabit.warnings.join(' ')).toContain('Initialization falls back');
  }, 30_000);
  it('uses the melatonin toggle alone while preserving uncertain-route exclusions', () => {
    const tokyo = { ...leg, arrivalAirport: 'HND', arrivalTimeZone: 'Asia/Tokyo', arrivalDateTime: '2026-10-16T00:00' };
    const large = generatePlan(trip([tokyo]), { ...prefs, preparationDays: 0, melatonin: true, melatoninAcknowledged: false });
    expect(all(large).some(action => action.type === 'melatonin')).toBe(false);
    const enabled = generatePlan(trip(), { ...prefs, melatonin: true, melatoninAcknowledged: false });
    const legacyEnabled = generatePlan(trip(), { ...prefs, melatonin: true, melatoninAcknowledged: true });
    expect(enabled.days).toEqual(legacyEnabled.days);
    expect(enabled.warnings).toEqual(legacyEnabled.warnings);
    expect(enabled.warnings.join(' ')).not.toContain('disabled until');
    expect(all(enabled).some(action => action.type === 'melatonin')).toBe(true);
    for (const melatoninAcknowledged of [false, true]) {
      const off = generatePlan(trip(), { ...prefs, melatonin: false, melatoninAcknowledged });
      expect(all(off).some(action => action.type === 'melatonin')).toBe(false);
    }
  }, 30_000);
  it('treats missed sleep as uncertain wake light and partial actual sleep as darkness only', () => {
    const original = generatePlan(trip(), prefs), sleep = all(original).find(action => action.type === 'sleep')!;
    const cutoff = Date.parse(sleep.end) + HOUR;
    const record = { id: 'sleep-record', tripId: 'model-test', actionId: sleep.id, type: sleep.type, scheduledStart: sleep.start, scheduledEnd: sleep.end, timeZone: sleep.timeZone, status: 'completed' as const, recordedAt: new Date(cutoff).toISOString() };
    const complete = generateModelPlanWithDiagnostics({ ...trip(), adherence: [record] }, prefs, { now: cutoff });
    const missed = generateModelPlanWithDiagnostics({ ...trip(), adherence: [{ ...record, status: 'missed' }] }, prefs, { now: cutoff });
    const partial = generateModelPlanWithDiagnostics({ ...trip(), adherence: [{ ...record, status: 'partial', actualStart: new Date(Date.parse(sleep.start) + 30 * 60_000).toISOString(), actualEnd: sleep.end }] }, prefs, { now: cutoff });
    expect(complete.diagnostics.finalists.map(candidate => candidate.score)).not.toEqual(missed.diagnostics.finalists.map(candidate => candidate.score));
    expect(all(partial.plan).filter(action => action.id !== sleep.id).every(action => Date.parse(action.start) >= cutoff)).toBe(true);
    expect(partial.plan.warnings.join(' ')).toContain('Sleep logs constrain assumed darkness');
  }, 30_000);
  it('bounds complete multi-stop numerical planning to ninety days', () => {
    const future = { ...leg, id: 'future', departureDateTime: '2027-01-09T18:00', arrivalDateTime: '2027-01-10T06:00' };
    const result = generatePlan(trip([leg, future]), prefs), actions = all(result);
    expect(Math.max(...actions.map(action => Date.parse(action.end))) - Math.min(...actions.map(action => Date.parse(action.start)))).toBeLessThanOrEqual(90 * DAY);
    expect(result.warnings.join(' ')).toContain('90-day');
  }, 30_000);
});

describe('extended flight validation', () => {
  it('accepts explicit DST fold choices and always rejects gap times', () => {
    const ambiguous = { ...leg, departureDateTime: '2026-11-01T01:30', arrivalDateTime: '2026-11-01T16:00', departureDisambiguation: 'later' as const };
    expect(validateTrip(trip([ambiguous]))).toEqual([]);
    expect(validateTrip(trip([{ ...ambiguous, departureDateTime: '2026-03-08T02:30', arrivalDateTime: '2026-03-08T16:00' }])).join(' ')).toContain('nonexistent');
  }, 30_000);
  it('rejects impossible airborne times or unreasonable taxi allowances', () => {
    expect(validateTrip(trip([{ ...leg, takeoffDateTime: '2026-10-14T17:50' }])).join(' ')).toContain('gate departure/arrival order');
    expect(validateTrip(trip([{ ...leg, taxiInMinutes: 300 }])).join(' ')).toContain('taxi allowances');
  }, 30_000);
});
