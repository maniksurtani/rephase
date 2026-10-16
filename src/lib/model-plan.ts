import { Temporal } from '@js-temporal/polyfill';
import { findAirport } from './airports';
import { splitDaylight } from './daylight';
import {
  entrainHabitual,
  phaseHours,
  simulateForger,
  estimateNadir,
  FORGER99_METADATA,
} from './circadian';
import type { CircadianSample, CircadianState } from './circadian';
import { dateInZone, localToInstant } from './time';
import { flightAirborneTiming } from './plan';
import { stayPlaceLabel } from './plan-places';
import type {
  AdaptationStrategy,
  AdherenceRecord,
  Plan,
  PlanAction,
  PlanDay,
  Preferences,
  Trip,
} from './types';

export const MODEL_PLAN_VERSION = 'model-2.0.0';
const HOUR = 3_600_000,
  DAY = 24 * HOUR,
  MINUTE = 60_000;
const CDC = 'https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html';
const LIGHT_SOURCE = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5852019/';
const wrap = (n: number) => ((n % 24) + 24) % 24;
const distance = (a: number, b: number) => Math.abs(wrap(a - b + 12) - 12);
const iso = (n: number) => new Date(Math.round(n)).toISOString();
const rounded = (n: number) => Math.round(n * 10) / 10;
type Range = { start: number; end: number };
type Input = Range & { lux: number; priority: number };
type Direction = 'advance' | 'delay';
type Stage = Range & {
  zone: string;
  airport: string;
  label: string;
  stage: PlanDay['stage'];
  kind: 'ground' | 'flight' | 'blocked';
  strategy: AdaptationStrategy;
  adapt: boolean;
  lieFlat?: boolean;
  preparationTargetZone?: string;
  targetKey?: string;
};
type DayEstimate = {
  start: number;
  time: number;
  startPhase: number;
  endPhase: number;
  targetPhase: number;
  routeHours: number;
  targetKey?: string;
  zone: string;
  note: string;
};
type Beam = {
  state: CircadianState;
  score: number;
  inputs: Input[];
  actions: PlanAction[];
  estimates: DayEstimate[];
  directions: Direction[];
  partialTargets: Record<string, number>;
};
export interface ModelPlanOptions {
  now?: number;
}
export interface ModelSearchDiagnostics {
  evaluatedCandidates: number;
  beamWidth: number;
  candidateStepMinutes: number;
  selectedDirections: Direction[];
  finalists: { score: number; directions: Direction[] }[];
  replayedUntil: number | null;
  partialTargets: Record<string, number>;
  partialTargetReferences: Record<string, { establishedAt: number; targetHours: number }[]>;
}

/** Calendar conversion occurs once per schedule interval, never inside the numerical integration loop. */
const clockCache = new Map<string, number>();
function clock(date: string, time: string, zone: string): number {
  const key = `${date}:${time}:${zone}`;
  const cached = clockCache.get(key);
  if (cached !== undefined) return cached;
  // A schedule preference on a DST transition uses the next representable time; flight input is stricter.
  const value = Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: 'compatible',
  }).epochMilliseconds;
  if (clockCache.size > 8192) clockCache.clear();
  clockCache.set(key, value);
  return value;
}
const addDate = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
const midnight = (time: number) => Math.floor(time / DAY) * DAY;
function chunks(range: Range, zone: string): Array<Range & { date: string }> {
  const result: Array<Range & { date: string }> = [];
  let start = Math.round(range.start);
  range = { start, end: Math.round(range.end) };
  while (start < range.end) {
    const date = dateInZone(start, zone),
      end = Math.min(range.end, clock(addDate(date, 1), '00:00', zone));
    if (end <= start) break;
    result.push({ start, end, date });
    start = end;
  }
  return result;
}
function subtract(range: Range, blocked: Range[]): Range[] {
  let result = [range];
  for (const block of blocked)
    result = result.flatMap((part) =>
      block.end <= part.start || block.start >= part.end
        ? [part]
        : [
            ...(block.start > part.start ? [{ start: part.start, end: block.start }] : []),
            ...(block.end < part.end ? [{ start: block.end, end: part.end }] : []),
          ],
    );
  return result.filter((part) => part.end - part.start >= 15 * MINUTE);
}
function sleepWake(date: string, zone: string, prefs: Preferences, usual = false): number {
  if (usual) return clock(date, prefs.usualWakeTime, zone);
  return prefs.sleepAnchor === 'wake'
    ? clock(date, prefs.preferredWakeTime, zone)
    : clock(date, prefs.preferredBedtime, zone) + prefs.sleepHours * HOUR;
}
function reportedHabitualHours(prefs: Preferences): number {
  const value = (time: string) => Number(time.slice(0, 2)) + Number(time.slice(3, 5)) / 60;
  return wrap(value(prefs.usualWakeTime) - value(prefs.usualBedtime));
}
function baselineSleepHours(prefs: Preferences): number {
  const span = reportedHabitualHours(prefs);
  return span >= 4 && span <= 12 ? span : prefs.sleepHours;
}
function habitualSleeps(start: number, end: number, prefs: Preferences): Range[] {
  const result: Range[] = [];
  let date = addDate(dateInZone(start, prefs.homeTimeZone), -1);
  const finalDate = addDate(dateInZone(end, prefs.homeTimeZone), 1);
  const reported = reportedHabitualHours(prefs),
    hasValidBaseline = reported >= 4 && reported <= 12;
  while (date <= finalDate) {
    const wake = sleepWake(date, prefs.homeTimeZone, prefs, true);
    const bedDate = prefs.usualBedtime < prefs.usualWakeTime ? date : addDate(date, -1);
    const bed = hasValidBaseline
      ? clock(bedDate, prefs.usualBedtime, prefs.homeTimeZone)
      : wake - prefs.sleepHours * HOUR;
    result.push({ start: bed, end: wake });
    date = addDate(date, 1);
  }
  return result;
}
/** A sorted sweep builds constant-light bins. Integration only binary-searches numbers. */
function lightCurve(
  inputs: Input[],
  start: number,
  end: number,
  background = 150,
): (time: number) => number {
  const events: { time: number; kind: 1 | -1; index: number }[] = [];
  inputs.forEach((input, index) => {
    if (input.end > start && input.start < end) {
      events.push(
        { time: Math.max(start, input.start), kind: 1, index },
        { time: Math.min(end, input.end), kind: -1, index },
      );
    }
  });
  events.sort((a, b) => a.time - b.time || a.kind - b.kind);
  const times = [start],
    lux = [background],
    active = new Set<number>();
  let index = 0;
  while (index < events.length) {
    const time = events[index].time;
    while (index < events.length && events[index].time === time) {
      const event = events[index++];
      if (event.kind === 1) active.add(event.index);
      else active.delete(event.index);
    }
    let selected = -1;
    for (const key of active)
      if (selected < 0 || inputs[key].priority > inputs[selected].priority) selected = key;
    times.push(time);
    lux.push(selected < 0 ? background : inputs[selected].lux);
  }
  return (time) => {
    let low = 0,
      high = times.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (times[middle] <= time) low = middle;
      else high = middle - 1;
    }
    return lux[low];
  };
}
function advanceState(
  state: CircadianState,
  start: number,
  end: number,
  inputs: Input[],
  step = 15,
): CircadianState {
  if (end <= start) return state;
  const values = simulateForger(state, start, end, lightCurve(inputs, start, end), step);
  const last = values[values.length - 1];
  return { x: last.x, xc: last.xc, n: last.n };
}
function initialState(start: number, prefs: Preferences, wakeOffset = 0): CircadianState {
  const wake = sleepWake(dateInZone(start, prefs.homeTimeZone), prefs.homeTimeZone, prefs, true);
  const wakeHours = wrap(wake / HOUR + wakeOffset),
    state = entrainHabitual(wakeHours, baselineSleepHours(prefs));
  const sleeps = habitualSleeps(midnight(start) - DAY, start + DAY, prefs).map((sleep) => ({
    start: sleep.start + wakeOffset * HOUR,
    end: sleep.end + wakeOffset * HOUR,
    lux: 0,
    priority: 1,
  }));
  return advanceState(state, midnight(start), start, sleeps, 5);
}
function estimatedNadirHours(state: CircadianState, time: number): number {
  return wrap(time / HOUR - phaseHours(state));
}
const habitualNadirCache = new Map<string, number>();
/** Target timing comes from an entrained oscillator trajectory, not wake-minus-a-fixed-offset. */
function habitualNadirHours(wakeHours: number, sleepHours: number): number {
  wakeHours = wrap(Math.round(wakeHours * 60) / 60);
  const key = `${wakeHours}:${sleepHours}`,
    cached = habitualNadirCache.get(key);
  if (cached !== undefined) return cached;
  const samples = simulateForger(
    entrainHabitual(wakeHours, sleepHours),
    0,
    36 * HOUR,
    (time) => (wrap(time / HOUR - wakeHours) < 24 - sleepHours ? 150 : 0),
    5,
  );
  const nadir = estimateNadir(samples, 0);
  const value =
    nadir === null
      ? estimatedNadirHours(samples[samples.length - 1], samples[samples.length - 1].time)
      : wrap(nadir / HOUR);
  if (habitualNadirCache.size >= 512) habitualNadirCache.clear();
  habitualNadirCache.set(key, value);
  return value;
}

function recordRange(record: AdherenceRecord): Range | null {
  const hasActualInterval = !!record.actualStart && !!record.actualEnd;
  const start = Date.parse(hasActualInterval ? record.actualStart! : record.scheduledStart),
    end = Date.parse(hasActualInterval ? record.actualEnd! : record.scheduledEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}
function pastInputs(trip: Trip, prefs: Preferences, start: number, end: number): Input[] {
  const inputs: Input[] = habitualSleeps(start, end, prefs).map((sleep) => ({
    ...sleep,
    lux: 0,
    priority: 1,
  }));
  for (const record of trip.adherence ?? []) {
    const range = recordRange(record);
    if (!range || range.start >= end) continue;
    if (!['light', 'avoid-light', 'sleep'].includes(record.type)) continue;
    if (record.status === 'missed') {
      inputs.push({
        start: Math.max(start, range.start),
        end: Math.min(end, range.end),
        lux: 150,
        priority: 3,
      });
      continue;
    }
    if (record.status === 'partial' && record.actualStart && record.actualEnd) {
      const scheduledStart = Date.parse(record.scheduledStart),
        scheduledEnd = Date.parse(record.scheduledEnd);
      if (scheduledEnd > start && scheduledStart < end)
        inputs.push({
          start: Math.max(start, scheduledStart),
          end: Math.min(end, scheduledEnd),
          lux: 150,
          priority: 2,
        });
    }
    let lux: number;
    if (record.type === 'light')
      lux = record.status === 'partial' && !(record.actualStart && record.actualEnd) ? 475 : 800;
    else if (record.type === 'avoid-light' || record.type === 'sleep')
      lux = record.status === 'partial' && !(record.actualStart && record.actualEnd) ? 75 : 0;
    else continue; // Caffeine and melatonin do not drive this light-only model.
    inputs.push({
      start: Math.max(start, range.start),
      end: Math.min(end, range.end),
      lux,
      priority: 3,
    });
  }
  return inputs;
}
function tripStages(
  trip: Trip,
  prefs: Preferences,
): {
  stages: Stage[];
  start: number;
  end: number;
  warnings: string[];
  flights: { departure: number; arrival: number }[];
} {
  const flights = trip.legs.map((leg) => ({
    leg,
    departure: localToInstant(
      leg.departureDateTime,
      leg.departureTimeZone,
      leg.departureDisambiguation,
    ),
    arrival: localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation),
    ...flightAirborneTiming(leg),
  }));
  const first = flights[0],
    last = flights[flights.length - 1],
    firstDestination = flights.find((flight) => flight.leg.stayAfter === 'destination') ?? last;
  const requestedStart = first.departure - prefs.preparationDays * DAY,
    start = Math.max(requestedStart, last.arrival - 90 * DAY),
    end = Math.min(start + 90 * DAY, last.arrival + 7 * DAY);
  const stages: Stage[] = [],
    warnings: string[] = [];
  let cursor = start;
  const add = (stage: Stage) => {
    stage = { ...stage, start: Math.max(start, stage.start), end: Math.min(end, stage.end) };
    if (stage.end <= stage.start) return;
    if (stage.start > cursor)
      stages.push({
        start: cursor,
        end: stage.start,
        zone: stage.zone,
        airport: stage.airport,
        label: 'Airport and transfer time',
        stage: 'travel',
        kind: 'blocked',
        strategy: 'home',
        adapt: false,
      });
    stages.push(stage);
    cursor = stage.end;
  };
  if (prefs.preparationDays)
    add({
      start,
      end: first.departure - 2 * HOUR,
      zone: first.leg.departureTimeZone,
      airport: first.leg.departureAirport,
      label: 'Before departure',
      stage: 'preparation',
      kind: 'ground',
      strategy: firstDestination.leg.strategy,
      adapt: firstDestination.leg.strategy !== 'home',
      preparationTargetZone: firstDestination.leg.arrivalTimeZone,
      targetKey: firstDestination.leg.id,
    });
  flights.forEach((flight, index) => {
    add({
      start: flight.takeoff + 30 * MINUTE,
      end: flight.landing - 60 * MINUTE,
      zone: flight.leg.arrivalTimeZone,
      airport: flight.leg.arrivalAirport,
      label: `${flight.leg.departureAirport} → ${flight.leg.arrivalAirport}`,
      stage: 'travel',
      kind: 'flight',
      strategy: 'home',
      adapt: false,
      lieFlat: flight.leg.lieFlat === true,
    });
    const onwards = flights[index + 1],
      destination = flight.leg.stayAfter === 'destination';
    add({
      start: flight.arrival + HOUR,
      end: onwards ? onwards.departure - 2 * HOUR : end,
      zone: flight.leg.arrivalTimeZone,
      airport: flight.leg.arrivalAirport,
      label: stayPlaceLabel(flight.leg.arrivalAirport, destination),
      stage: destination
        ? flight.leg.arrivalTimeZone === prefs.homeTimeZone
          ? 'home'
          : 'destination'
        : 'travel',
      kind: 'ground',
      strategy: destination ? flight.leg.strategy : 'home',
      adapt: destination && flight.leg.strategy !== 'home',
      ...(destination ? { targetKey: flight.leg.id } : {}),
    });
    if (
      onwards &&
      flight.leg.arrivalAirport.toUpperCase() !== onwards.leg.departureAirport.toUpperCase()
    )
      warnings.push(
        `A surface transfer is required between ${flight.leg.arrivalAirport} and ${onwards.leg.departureAirport}. No transport-specific sleep or light access is known; review this gap.`,
      );
    if (
      destination &&
      onwards &&
      onwards.departure - flight.arrival < 2 * DAY &&
      flight.leg.strategy === 'adapt'
    )
      warnings.push(
        `The stay after ${flight.leg.arrivalAirport} is under two days; maintaining home time or partial adjustment may be more practical.`,
      );
  });
  if (cursor < end)
    stages.push({
      start: cursor,
      end,
      zone: last.leg.arrivalTimeZone,
      airport: last.leg.arrivalAirport,
      label: 'Airport and transfer time',
      stage: 'travel',
      kind: 'blocked',
      strategy: 'home',
      adapt: false,
    });
  if (start > requestedStart)
    warnings.push(
      'Some preparation time is omitted to keep every flight inside the 90-day model horizon.',
    );
  if (end < last.arrival + 7 * DAY)
    warnings.push('Some post-trip days are omitted by the 90-day model horizon.');
  return { stages, start, end, warnings, flights };
}
function candidateSleeps(
  stage: Stage,
  state: CircadianState,
  prefs: Preferences,
  direction: Direction,
  frozenPartialTarget?: number,
): { sleeps: Range[]; targetHours: number; wakeHours: number; routeHours: number } {
  const baselineWake = wrap(
    sleepWake(dateInZone(stage.start, prefs.homeTimeZone), prefs.homeTimeZone, prefs, true) / HOUR,
  );
  const wakeAfterNadir = wrap(
    baselineWake - habitualNadirHours(baselineWake, baselineSleepHours(prefs)),
  );
  const currentWake = wrap(estimatedNadirHours(state, stage.start) + wakeAfterNadir);
  const targetZone =
    stage.preparationTargetZone ?? (stage.strategy === 'home' ? prefs.homeTimeZone : stage.zone);
  const fullWanted = wrap(
    sleepWake(dateInZone(stage.start, targetZone), targetZone, prefs, stage.strategy === 'home') /
      HOUR,
  );
  const fullTarget = habitualNadirHours(fullWanted, prefs.sleepHours);
  let wanted = fullWanted,
    targetHours = fullTarget;
  if (stage.strategy === 'partial') {
    const currentNadir = estimatedNadirHours(state, stage.start);
    const phaseRoute =
      direction === 'advance' ? wrap(currentNadir - fullTarget) : wrap(fullTarget - currentNadir);
    targetHours =
      frozenPartialTarget ??
      wrap(currentNadir + (direction === 'advance' ? -phaseRoute / 2 : phaseRoute / 2));
    // A partial target is established once, then reused by preparation and its destination.
    wanted = wrap(targetHours + wrap(fullWanted - fullTarget));
  }
  const route = direction === 'advance' ? wrap(currentWake - wanted) : wrap(wanted - currentWake);
  if (stage.kind === 'blocked')
    return { sleeps: [], targetHours, wakeHours: currentWake, routeHours: route };
  if (stage.kind === 'ground' && !stage.adapt) {
    if (stage.stage === 'travel' && stage.end - stage.start < (prefs.sleepHours + 1) * HOUR)
      return {
        sleeps: [],
        targetHours: habitualNadirHours(wanted, prefs.sleepHours),
        wakeHours: wanted,
        routeHours: route,
      };
    const sleeps: Range[] = [];
    let d = addDate(dateInZone(stage.start, prefs.homeTimeZone), -1);
    const endDate = addDate(dateInZone(stage.end, prefs.homeTimeZone), 1);
    while (d <= endDate) {
      const wake = sleepWake(d, prefs.homeTimeZone, prefs, true);
      sleeps.push({ start: wake - prefs.sleepHours * HOUR, end: wake });
      d = addDate(d, 1);
    }
    return {
      sleeps,
      targetHours: habitualNadirHours(wanted, prefs.sleepHours),
      wakeHours: wanted,
      routeHours: route,
    };
  }
  const sleeps: Range[] = [];
  for (let day = -1; day <= Math.ceil((stage.end - stage.start) / DAY) + 2; day++) {
    const baseWake = midnight(stage.start) + day * DAY + currentWake * HOUR;
    // Preparation moves at most 1 h/day; ground plans use the same bounded change and preserve elapsed sleep duration.
    const progress = stage.adapt ? Math.min(route, Math.max(0, (baseWake - stage.start) / DAY)) : 0;
    const wake = baseWake + (direction === 'advance' ? -progress : progress) * HOUR;
    sleeps.push({ start: wake - prefs.sleepHours * HOUR, end: wake });
  }
  return { sleeps, targetHours, wakeHours: currentWake, routeHours: route };
}
function makeAction(
  trip: Trip,
  stage: Stage,
  type: PlanAction['type'],
  range: Range,
  title: string,
  detail: string,
  reason: string,
  feasibility?: PlanAction['feasibility'],
  dose?: string,
): PlanAction {
  const start = iso(range.start),
    end = iso(range.end);
  return {
    id: `${trip.id}:${type}:${start}:${end}:${stage.zone}`,
    type,
    start,
    end,
    timeZone: stage.zone,
    title,
    detail,
    reason,
    evidenceUrl: type === 'light' || type === 'avoid-light' ? LIGHT_SOURCE : CDC,
    ...(feasibility ? { feasibility } : {}),
    ...(dose ? { dose } : {}),
  };
}
function runCandidate(
  beam: Beam,
  stage: Stage,
  prefs: Preferences,
  trip: Trip,
  direction: Direction,
): Beam {
  const next: Beam = {
    ...beam,
    inputs: [...beam.inputs],
    actions: [...beam.actions],
    estimates: [...beam.estimates],
    directions: stage.adapt ? [...beam.directions, direction] : [...beam.directions],
    partialTargets: { ...beam.partialTargets },
  };
  const schedule = candidateSleeps(
    stage,
    beam.state,
    prefs,
    direction,
    stage.targetKey ? beam.partialTargets[stage.targetKey] : undefined,
  );
  if (stage.strategy === 'partial' && stage.targetKey)
    next.partialTargets[stage.targetKey] = schedule.targetHours;
  const fullSleeps = schedule.sleeps
    .map((sleep) => ({
      start: Math.max(stage.start, sleep.start),
      end: Math.min(stage.end, sleep.end),
    }))
    .filter((sleep) => sleep.end - sleep.start >= (stage.kind === 'flight' ? 30 : 15) * MINUTE);
  const stageInputs: Input[] = fullSleeps.map((sleep) => ({ ...sleep, lux: 0, priority: 2 }));
  for (const sleep of fullSleeps) {
    const inFlight = stage.kind === 'flight';
    next.actions.push(
      makeAction(
        trip,
        stage,
        'sleep',
        sleep,
        inFlight && !stage.lieFlat ? 'Rest or nap' : 'Bedtime',
        inFlight
          ? stage.lieFlat
            ? 'Sleep starts at least 30 minutes after takeoff and ends at least 60 minutes before landing.'
            : 'Rest or nap as your seat allows. An eye mask, earplugs and head support may help. Rest starts at least 30 minutes after takeoff and ends at least 60 minutes before landing.'
          : `Aim for ${prefs.sleepHours} hours of sleep. Bedtime moves by at most one hour per day.`,
        'Sleep supports alertness and recovery.',
      ),
    );
  }
  let cursor = stage.start;
  while (cursor < stage.end) {
    const end = Math.min(stage.end, cursor + DAY),
      chunk = { start: cursor, end },
      state = next.state;
    // Forecast a genuine x minimum under the candidate sleep/darkness schedule. The angular proxy is a fallback for short/atypical trajectories.
    const probeInputs = schedule.sleeps.map((sleep) => ({ ...sleep, lux: 0, priority: 2 }));
    const probe = simulateForger(
      state,
      cursor,
      cursor + 30 * HOUR,
      lightCurve(probeInputs, cursor, cursor + 30 * HOUR),
      15,
    );
    const nadir = estimateNadir(probe, cursor) ?? cursor - phaseHours(state) * HOUR;
    const localTargetZone =
      stage.preparationTargetZone ?? (stage.strategy === 'home' ? prefs.homeTimeZone : stage.zone);
    const desiredTarget =
      stage.strategy === 'partial'
        ? schedule.targetHours
        : habitualNadirHours(
            wrap(
              sleepWake(
                dateInZone(end, localTargetZone),
                localTargetZone,
                prefs,
                stage.strategy === 'home',
              ) / HOUR,
            ),
            prefs.sleepHours,
          );
    const localInputs = [...stageInputs];
    let lightBurden = 0;
    if (stage.kind === 'ground' && stage.adapt) {
      for (let offset = -1; offset <= 2; offset++) {
        const minimum = nadir + offset * DAY;
        // Broad windows remain two hours away from the estimated nadir, reflecting unmeasured phase uncertainty.
        const seek =
          direction === 'advance'
            ? { start: minimum + 2 * HOUR, end: minimum + 5 * HOUR }
            : { start: minimum - 5 * HOUR, end: minimum - 2 * HOUR };
        const avoid =
          direction === 'advance'
            ? { start: minimum - 5 * HOUR, end: minimum - 2 * HOUR }
            : { start: minimum + 2 * HOUR, end: minimum + 5 * HOUR };
        for (const interval of subtract(
          { start: Math.max(chunk.start, seek.start), end: Math.min(chunk.end, seek.end) },
          fullSleeps,
        )) {
          for (const piece of chunks(interval, stage.zone))
            for (const feasible of splitDaylight(
              piece,
              piece.date,
              stage.zone,
              findAirport(stage.airport),
            )) {
              if (feasible.end - feasible.start < 15 * MINUTE) continue;
              const indoor = feasible.feasibility !== 'daylight',
                lux = indoor ? 500 : 1000;
              localInputs.push({ start: feasible.start, end: feasible.end, lux, priority: 1 });
              lightBurden += ((feasible.end - feasible.start) / HOUR) * (indoor ? 0.12 : 0.02);
              next.actions.push(
                makeAction(
                  trip,
                  stage,
                  'light',
                  feasible,
                  indoor ? 'Seek bright indoor light' : 'Seek daylight',
                  feasible.feasibility === 'unknown'
                    ? 'Airport coordinates are unknown, so outdoor daylight cannot be checked. Use ordinary bright indoor lighting when practical; its effect is uncertain.'
                    : indoor
                      ? 'The sun is below the horizon during this window. Use bright indoor lighting if comfortable and practical; ordinary room light may be less effective than the model assumes.'
                      : 'Spend time outdoors or near available daylight when practical. Weather and buildings change actual exposure; never stare at the sun.',
                  `This ${direction} candidate uses a light-driven oscillator to estimate a broad useful window. Circadian phase and received light are unmeasured; the result is a planning estimate.`,
                  feasible.feasibility,
                ),
              );
            }
        }
        for (const interval of subtract(
          { start: Math.max(chunk.start, avoid.start), end: Math.min(chunk.end, avoid.end) },
          fullSleeps,
        )) {
          localInputs.push({ ...interval, lux: 10, priority: 1 });
          next.actions.push(
            makeAction(
              trip,
              stage,
              'avoid-light',
              interval,
              'Keep light low',
              'Use dim indoor light and lower screen brightness. Safe navigation, work, and airport instructions take priority.',
              'Light at the opposite part of the estimated biological night can shift the clock away from the selected route. Timing remains uncertain.',
            ),
          );
        }
      }
    }
    const trajectory = simulateForger(state, cursor, end, lightCurve(localInputs, cursor, end), 15);
    const final = trajectory[trajectory.length - 1];
    next.state = { x: final.x, xc: final.xc, n: final.n };
    const actualNadir = estimateNadir(trajectory, cursor);
    const phaseStart = wrap(nadir / HOUR),
      phaseEnd =
        actualNadir === null ? estimatedNadirHours(next.state, end) : wrap(actualNadir / HOUR);
    if (stage.kind === 'ground')
      next.score += (distance(phaseEnd, desiredTarget) * (end - cursor)) / DAY + lightBurden;
    next.estimates.push({
      start: cursor,
      time: end,
      startPhase: phaseStart,
      endPhase: phaseEnd,
      targetPhase: desiredTarget,
      routeHours: schedule.routeHours,
      ...(stage.strategy === 'partial' && stage.targetKey ? { targetKey: stage.targetKey } : {}),
      zone: stage.zone,
      note:
        stage.kind === 'blocked'
          ? 'Airport/transfer buffers have no timed recommendations.'
          : stage.kind === 'flight'
            ? 'Only a protected rest opportunity is offered in flight; seat comfort does not change the body-clock model.'
            : stage.adapt
              ? `${direction === 'advance' ? 'Earlier' : 'Later'} adjustment was selected by simulating feasible candidate schedules. Sleep changes by at most 1 hour/day; estimated response can vary by hours.`
              : 'Maintain the home sleep schedule when practical; the simulated state continues through connections and previous destinations.',
    });
    next.inputs.push(
      ...localInputs
        .filter((input) => input.end > cursor && input.start < end)
        .map((input) => ({
          ...input,
          start: Math.max(cursor, input.start),
          end: Math.min(end, input.end),
        })),
    );
    cursor = end;
  }
  if (stage.kind === 'ground' && stage.adapt)
    next.score +=
      distance(next.estimates[next.estimates.length - 1].endPhase, schedule.targetHours) * 2;
  return next;
}
function loggedActions(trip: Trip, cutoff: number): PlanAction[] {
  return (trip.adherence ?? []).flatMap((record) => {
    const range = recordRange(record);
    if (!range || Date.parse(record.scheduledStart) >= cutoff) return [];
    return [
      {
        id: record.actionId,
        type: record.type,
        start: record.scheduledStart,
        end: iso(Math.min(cutoff, Date.parse(record.scheduledEnd))),
        timeZone: record.timeZone,
        title: `Logged ${record.type.replace('-', ' ')} · ${record.status}`,
        detail: 'This saved observation is preserved. Only future recommendations are regenerated.',
        reason:
          'A completion log is not a measurement of body-clock phase, actual lux, or sleep quality.',
      },
    ];
  });
}
function auxiliaryActions(
  actions: PlanAction[],
  stages: Stage[],
  trip: Trip,
  prefs: Preferences,
  estimates: DayEstimate[],
): PlanAction[] {
  const result = [...actions],
    sleeps = actions
      .filter((action) => action.type === 'sleep')
      .map((action) => ({ start: Date.parse(action.start), end: Date.parse(action.end) }));
  for (const sleep of sleeps) {
    const stage = stages.find(
      (stage) =>
        stage.kind === 'ground' &&
        sleep.start >= stage.start &&
        sleep.end <= stage.end &&
        stage.stage !== 'travel',
    );
    if (!stage) continue;
    if (prefs.caffeine)
      for (const range of subtract(
        { start: sleep.end, end: Math.min(stage.end, sleep.end + 2 * HOUR) },
        sleeps.map((next) => ({ start: next.start - 8 * HOUR, end: next.end })),
      ))
        result.push(
          makeAction(
            trip,
            stage,
            'caffeine',
            range,
            'Optional caffeine',
            'Use your usual modest amount only if suitable for you. Stop at least eight hours before planned sleep, earlier if sensitive.',
            'Caffeine can support alertness but does not replace sleep. No caffeine phase-response effect is simulated.',
          ),
        );
    // Melatonin is informational and is never an input to the unvalidated light-only dynamics.
    const phaseEstimate = estimates.find(
      (estimate) => estimate.zone === stage.zone && estimate.time >= sleep.start,
    );
    if (
      prefs.melatonin &&
      stage.adapt &&
      !stage.preparationTargetZone &&
      phaseEstimate?.note.startsWith('Earlier') &&
      phaseEstimate.routeHours < 8 &&
      sleep.end - sleep.start >= prefs.sleepHours * HOUR - 1
    ) {
      const candidate = sleep.start - HOUR,
        localHour = Temporal.Instant.fromEpochMilliseconds(
          Math.round(candidate),
        ).toZonedDateTimeISO(stage.zone).hour;
      if (
        candidate >= stage.start &&
        sleep.end <= stage.end &&
        localHour >= 18 &&
        localHour <= 23 &&
        wrap(candidate / HOUR - phaseEstimate.endPhase) >= 11 &&
        wrap(candidate / HOUR - phaseEstimate.endPhase) <= 16.5
      )
        result.push(
          makeAction(
            trip,
            stage,
            'melatonin',
            { start: candidate, end: candidate + 15 * MINUTE },
            'Optional melatonin: general bedtime information',
            'CDC guidance describes 0.5–1 mg as often sufficient for a circadian shift. This is general information, not a personal dose or a predicted effect. Timing can shift the clock in the wrong direction; check suitability with a clinician. Skip if driving, working, or unable to sleep soon; never wake to take it.',
            'This light-only model does not simulate melatonin or determine an optimal dose. Bedtime information is optional; phase-specific dosing needs measured timing and individual assessment.',
            undefined,
            '0.5–1 mg · general information',
          ),
        );
    }
  }
  const blocks = sleeps;
  return result.flatMap((action) =>
    action.type === 'light' || action.type === 'avoid-light' || action.type === 'melatonin'
      ? subtract({ start: Date.parse(action.start), end: Date.parse(action.end) }, blocks).map(
          (part) => ({ ...action, start: iso(part.start), end: iso(part.end) }),
        )
      : [action],
  );
}
/** Genuine modeled low points, using the kernel's existing interpolation on each local minimum. */
function trajectoryNadirs(samples: CircadianSample[]): number[] {
  const nadirs: number[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].x > samples[i - 1].x || samples[i].x >= samples[i + 1].x) continue;
    const nadir = estimateNadir(samples.slice(i - 1, i + 2), samples[i - 1].time);
    if (nadir !== null) nadirs.push(nadir);
  }
  return nadirs;
}
function displayDays(
  actions: PlanAction[],
  stages: Stage[],
  estimates: DayEstimate[],
  nadirs: number[],
  tripId: string,
  loggedIds: Set<string>,
): PlanDay[] {
  const map = new Map<string, PlanDay>();
  for (const action of actions)
    for (const piece of chunks(
      { start: Date.parse(action.start), end: Date.parse(action.end) },
      action.timeZone,
    )) {
      const key = `${piece.date}:${action.timeZone}`;
      let day = map.get(key);
      if (!day) {
        const stage =
          stages.find((stage) => piece.start >= stage.start && piece.start < stage.end) ??
          stages[stages.length - 1];
        const dayStart = clock(piece.date, '00:00', action.timeZone),
          dayEnd = clock(addDate(piece.date, 1), '00:00', action.timeZone);
        const estimate = estimates
          .filter(
            (estimate) =>
              estimate.zone === action.timeZone &&
              estimate.start < dayEnd &&
              estimate.time > dayStart,
          )
          .at(-1);
        const todayNadirs = nadirs
          .map((time, index) => ({ time, previous: nadirs[index - 1] }))
          .filter((nadir) => nadir.time >= dayStart && nadir.time < dayEnd);
        // A day without two successive low points has no daily change estimate. Close cusp minima or
        // a missing cycle are ambiguous, so do not turn them into a large apparent circadian shift.
        const usable =
          todayNadirs.length === 1 &&
          todayNadirs[0].previous !== undefined &&
          todayNadirs[0].time - todayNadirs[0].previous > 12 * HOUR &&
          todayNadirs[0].time - todayNadirs[0].previous < 36 * HOUR;
        const available = !!estimate && usable;
        // Positive means the next biological low is earlier; preserve small changes for honest display.
        const shift = available ? 24 - (todayNadirs[0].time - todayNadirs[0].previous) / HOUR : 0;
        day = {
          id: key,
          date: piece.date,
          timeZone: action.timeZone,
          locationAirport: stage?.airport,
          label: stage?.label ?? 'Saved observation',
          stage: stage?.stage ?? 'travel',
          actions: [],
          phaseShiftHours: shift,
          phaseEstimateAvailable: available,
          remainingShiftHours: estimate
            ? rounded(distance(estimate.endPhase, estimate.targetPhase))
            : 0,
          note: `${estimate?.note ?? 'Saved history; future-only replanning.'} ${available ? 'Body-clock change is the difference between successive simulated biological low points, assigned to the local date of the later low. ' : 'No daily body-clock change is available without two unambiguous simulated biological low points and model coverage for this day. '}Body-clock phase is an unmeasured estimate, not a promised outcome.`,
        };
        map.set(key, day);
      }
      const start = iso(piece.start),
        end = iso(piece.end);
      day.actions.push({
        ...action,
        id: loggedIds.has(action.id)
          ? action.id
          : `${tripId}:${action.type}:${start}:${end}:${action.timeZone}`,
        start,
        end,
      });
    }
  return [...map.values()]
    .map((day) => ({
      ...day,
      actions: day.actions.sort(
        (a, b) => a.start.localeCompare(b.start) || a.type.localeCompare(b.type),
      ),
    }))
    .sort((a, b) => clock(a.date, '00:00', a.timeZone) - clock(b.date, '00:00', b.timeZone));
}

export function generateModelPlanWithDiagnostics(
  trip: Trip,
  prefs: Preferences,
  options: ModelPlanOptions = {},
): { plan: Plan; diagnostics: ModelSearchDiagnostics } {
  const {
    stages: originalStages,
    start,
    end,
    warnings: stageWarnings,
    flights,
  } = tripStages(trip, prefs);
  const validLogs = (trip.adherence ?? []).filter(
    (record) =>
      record.tripId === trip.id &&
      ['completed', 'missed', 'partial'].includes(record.status) &&
      recordRange(record) &&
      Date.parse(record.recordedAt) <= (options.now ?? Date.now()),
  );
  const cutoff = validLogs.length
    ? Math.max(start, Math.min(end, options.now ?? Date.now()))
    : start;
  const past =
    cutoff > start ? pastInputs({ ...trip, adherence: validLogs }, prefs, start, cutoff) : [];
  const initial = initialState(start, prefs),
    carried = advanceState(initial, start, cutoff, past, 5);
  const stages = originalStages
    .filter((stage) => stage.end > cutoff)
    .map((stage) => ({ ...stage, start: Math.max(stage.start, cutoff) }));
  let beam: Beam[] = [
      {
        state: carried,
        score: 0,
        inputs: [],
        actions: [],
        estimates: [],
        directions: [],
        partialTargets: {},
      },
    ],
    evaluatedCandidates = 0;
  for (const stage of stages) {
    const candidates: Beam[] = [];
    for (const parent of beam)
      for (const direction of stage.adapt
        ? (['advance', 'delay'] as const)
        : (['advance'] as const)) {
        candidates.push(runCandidate(parent, stage, prefs, trip, direction));
        evaluatedCandidates++;
      }
    // Bounded beam retains competing routes through subsequent destinations instead of resetting at each stop.
    beam = candidates.sort((a, b) => a.score - b.score).slice(0, 3);
  }
  const selected = beam[0],
    finalInputs = [...past, ...selected.inputs];
  // Replay the selected route at a finer integration step and with +/-2 h baseline states.
  const nominalTrajectory = simulateForger(
      initial,
      start,
      end,
      lightCurve(finalInputs, start, end),
      5,
    ),
    nominal = nominalTrajectory[nominalTrajectory.length - 1];
  const earlier = advanceState(initialState(start, prefs, -2), start, end, finalInputs, 5),
    later = advanceState(initialState(start, prefs, 2), start, end, finalInputs, 5);
  const spread = Math.max(
    distance(estimatedNadirHours(nominal, end), estimatedNadirHours(earlier, end)),
    distance(estimatedNadirHours(nominal, end), estimatedNadirHours(later, end)),
  );
  const warnings = [
    'This uses a numerically verified research-model kernel in a planning prototype, not a clinically validated app or a measurement of your circadian phase. Recommendations can be wrong for an individual.',
    'The initial biological low point is estimated from an assumed habitual sleep/light schedule, with at least ±2 hours of uncertainty. Chronotype does not add an invented offset; actual phase requires measurement.',
    'Light inputs are assumed: darkness 0 lux, dim light 10 lux, ordinary wake background 150 lux, bright indoor 500 lux, and daylight opportunity 1,000 lux. Completed light logs use an 800-lux proxy unless actual light is measured in a future version. Received light, weather, adherence, and sleep quality are unmeasured.',
    `Advance and delay candidates are simulated with a bounded beam across the complete itinerary. A ±2-hour starting-phase sensitivity replay ends with about ${rounded(spread)} hours of modeled spread; this is a sensitivity check, not a confidence interval.`,
    'The model simulates light-driven circadian dynamics only. Sleep logs constrain assumed darkness; sleep debt, naps, caffeine, and melatonin effects are not physiologically modeled.',
    ...stageWarnings,
  ];
  const reportedHabit = reportedHabitualHours(prefs);
  if (reportedHabit < 4 || reportedHabit > 12)
    warnings.push(
      'Your reported usual bedtime/wake interval is outside the supported 4–12-hour habitual baseline, or has zero duration. Initialization falls back to your required sleep duration; check your actual habitual times before relying on phase estimates.',
    );
  else if (Math.abs(reportedHabit - prefs.sleepHours) > 0.01)
    warnings.push(
      `Your usual bedtime/wake interval is ${rounded(reportedHabit)} hours, separate from your requested ${prefs.sleepHours} hours. Initial and past darkness follows the actual usual times; future sleep opportunities preserve the requested duration, so a home-time bedtime may move earlier or later. This does not infer sleep quality.`,
    );
  if (prefs.sleepHours < 7)
    warnings.push(
      'Most adults need at least seven hours of sleep. Timing guidance cannot correct insufficient sleep.',
    );
  if (validLogs.length)
    warnings.push(
      `Past light/sleep logs were replayed up to ${iso(cutoff)}; only future recommendations are regenerated. Missed instructions use uncertain habitual/background light, and partial logs without actual times use an approximate exposure. Completion does not establish actual phase.`,
    );
  const allActions = [
    ...loggedActions({ ...trip, adherence: validLogs }, cutoff),
    ...auxiliaryActions(selected.actions, stages, trip, prefs, selected.estimates),
  ];
  if (!allActions.some((action) => action.type === 'sleep'))
    warnings.push(
      'No protected sleep opportunity fits. Allow recovery sleep and review transfers.',
    );
  const uniqueDirections = [...new Set(selected.directions)],
    strategy = uniqueDirections.length > 1 ? 'mixed' : (uniqueDirections[0] ?? 'mixed');
  return {
    plan: {
      version: MODEL_PLAN_VERSION,
      tripId: trip.id,
      generatedAt: iso(options.now ?? Date.now()),
      days: displayDays(
        allActions,
        originalStages,
        selected.estimates,
        trajectoryNadirs(nominalTrajectory),
        trip.id,
        new Set(validLogs.map((record) => record.actionId)),
      ),
      warnings,
      summary: {
        destinations: trip.legs.filter((leg) => leg.stayAfter === 'destination').length,
        flightHours: rounded(
          flights.reduce((sum, flight) => sum + (flight.arrival - flight.departure) / HOUR, 0),
        ),
        timeZoneChanges: trip.legs.filter((leg) => leg.departureTimeZone !== leg.arrivalTimeZone)
          .length,
      },
      model: {
        name: FORGER99_METADATA.name,
        numericallyVerified: FORGER99_METADATA.numericallyVerified,
        clinicallyValidated: false,
        strategy,
        assumptions: [
          `Habitual 150 lux waking / 0 lux sleep baseline uses usual bedtime/wake duration (${rounded(baselineSleepHours(prefs))} hours), initialized through 21 repeated days; biological entrainment is not established for every person or schedule.`,
          'Fixed published light-only model parameters; no personalized biological measurements. Target x-minimum timing is derived from the target habitual sleep/light oscillator, not a fixed wake-minus-hours rule.',
          'Two directional candidates per adapting stage, beam width 3, 15-minute search integration and 5-minute selected-route sensitivity replay. Light windows forecast actual modeled x minima; an angular phase proxy is used only if a trajectory has no minimum.',
          'At most one hour/day planned sleep changes, preserving requested elapsed sleep duration when unconstrained. Partial targets are established once per stay and shared by preparation and that destination.',
          'Gate times include default 30-minute taxi allowances; explicit airborne times override them.',
          'No phase-shift benefit from seat class, sleep quality, caffeine, or melatonin is inferred.',
        ],
      },
    },
    diagnostics: {
      evaluatedCandidates,
      beamWidth: 3,
      candidateStepMinutes: 15,
      selectedDirections: selected.directions,
      finalists: beam.map((candidate) => ({
        score: rounded(candidate.score),
        directions: candidate.directions,
      })),
      replayedUntil: cutoff > start ? cutoff : null,
      partialTargets: selected.partialTargets,
      partialTargetReferences: selected.estimates.reduce<
        Record<string, { establishedAt: number; targetHours: number }[]>
      >((references, estimate) => {
        if (estimate.targetKey)
          (references[estimate.targetKey] ??= []).push({
            establishedAt: estimate.time,
            targetHours: estimate.targetPhase,
          });
        return references;
      }, {}),
    },
  };
}
export function generateModelPlan(
  trip: Trip,
  prefs: Preferences,
  options?: ModelPlanOptions,
): Plan {
  return generateModelPlanWithDiagnostics(trip, prefs, options).plan;
}
