import { Temporal } from '@js-temporal/polyfill';
import type { AdaptationStrategy, Plan, PlanAction, PlanDay, Preferences, Trip } from './types';
import { dateInZone, localToInstant } from './time';
import { generateModelPlan, type ModelPlanOptions } from './model-plan';
import { decoratePlanWithTravel } from './plan-travel';
import { decoratePlanWithMeals } from './plan-meals';

export const PLAN_VERSION = 'rules-1.2.0';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_HORIZON = 90 * DAY;
const CDC = 'https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html';
const LIGHT_PRC = 'https://pubmed.ncbi.nlm.nih.gov/12717008/';
const scheduleClockCache = new Map<string, number>();
type Range = { start: number; end: number };
type Segment = Range & {
  zone: string;
  stage: PlanDay['stage'];
  label: string;
  strategy: AdaptationStrategy;
  adapt: boolean;
  flight: boolean;
  lieFlat?: boolean;
};
type RawAction = PlanAction & { startMs: number; endMs: number };
const wrap = (hours: number) => ((hours % 24) + 24) % 24;
// Positive means an advance (earlier in UTC); negative means a delay.
const neededShift = (phase: number, target: number) => {
  const shift = wrap(phase - target + 12) - 12;
  return shift === -12 ? -12 : shift;
};
const rounded = (value: number) => Math.round(value * 10) / 10;
const iso = (instant: number) => new Date(instant).toISOString();

/** Date/clock conversion for schedule opportunities, allowing a DST transition to use its real instant. */
function clock(date: string, time: string, zone: string): number {
  const key = `${date}:${time}:${zone}`;
  const cached = scheduleClockCache.get(key);
  if (cached !== undefined) return cached;
  const instant = Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: 'compatible',
  }).epochMilliseconds;
  if (scheduleClockCache.size >= 4096) scheduleClockCache.clear();
  scheduleClockCache.set(key, instant);
  return instant;
}
function plusDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
function validZone(zone: string): boolean {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}
function pieces(segment: Segment): Array<Segment & { date: string }> {
  const result: Array<Segment & { date: string }> = [];
  let start = segment.start;
  while (start < segment.end) {
    const date = dateInZone(start, segment.zone);
    const midnight = clock(plusDate(date, 1), '00:00', segment.zone);
    const end = Math.min(segment.end, midnight);
    if (end <= start) break;
    result.push({ ...segment, start, end, date });
    start = end;
  }
  return result;
}

export function validateTrip(trip: Trip): string[] {
  const errors: string[] = [];
  if (!trip.legs?.length) return ['Add at least one flight.'];
  if (trip.legs.length > 30) return ['A trip can include up to 30 flight legs.'];
  let previousArrival: number | undefined;
  let firstDeparture: number | undefined;
  let lastArrival: number | undefined;
  const ids = new Set<string>();
  trip.legs.forEach((leg, index) => {
    const prefix = `Flight ${index + 1}`;
    if (!leg.id || ids.has(leg.id)) errors.push(`${prefix}: use a unique flight identifier.`);
    ids.add(leg.id);
    if (!/^[A-Z0-9]{3,4}$/.test(leg.departureAirport) || !/^[A-Z0-9]{3,4}$/.test(leg.arrivalAirport)) {
      errors.push(`${prefix}: select departure and arrival airports using a 3–4 character uppercase airport code.`);
    }
    if (!['connection', 'destination'].includes(leg.stayAfter)) {
      errors.push(`${prefix}: choose a connection or destination stay.`);
    }
    if (!['adapt', 'partial', 'home'].includes(leg.strategy)) {
      errors.push(`${prefix}: choose an adaptation strategy.`);
    }
    let departure: number | undefined;
    let arrival: number | undefined;
    try {
      departure = localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation);
    } catch {
      errors.push(`${prefix}: departure date/time or zone is invalid, nonexistent, or ambiguous during daylight saving. Choose a valid local time; select earlier or later when that clock occurs twice.`);
    }
    try {
      arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation);
    } catch {
      errors.push(`${prefix}: arrival date/time or zone is invalid, nonexistent, or ambiguous during daylight saving. Choose a valid local time; select earlier or later when that clock occurs twice.`);
    }
    if (departure !== undefined && arrival !== undefined) {
      if (arrival <= departure) errors.push(`${prefix}: arrival must follow departure in real time.`);
      for (const minutes of [leg.taxiOutMinutes, leg.taxiInMinutes]) {
        if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0 || minutes > 180)) errors.push(`${prefix}: taxi allowances must be between 0 and 180 minutes.`);
      }
      try {
        const airborne = flightAirborneTiming(leg);
        if (airborne.takeoff < departure || airborne.landing > arrival || (airborne.landing <= airborne.takeoff && (leg.takeoffDateTime || leg.landingDateTime || leg.taxiOutMinutes !== undefined || leg.taxiInMinutes !== undefined))) {
          errors.push(`${prefix}: takeoff and landing must fit in gate departure/arrival order; revise airborne times or taxi allowances.`);
        }
      } catch {
        errors.push(`${prefix}: airborne takeoff or landing time is invalid, nonexistent, or ambiguous.`);
      }
      if (arrival - departure > 36 * HOUR) errors.push(`${prefix}: flight duration exceeds 36 hours; check dates and zones.`);
      if (previousArrival !== undefined && departure < previousArrival + HOUR / 2) {
        errors.push(`${prefix}: leave at least 30 minutes after the previous arrival and put flights in travel order.`);
      }
      firstDeparture ??= departure;
      previousArrival = arrival;
      lastArrival = arrival;
    }
  });
  if (firstDeparture !== undefined && lastArrival !== undefined && lastArrival - firstDeparture > MAX_HORIZON) {
    errors.push('The trip exceeds the supported 90-day planning horizon. Split it into shorter trips.');
  }
  return errors;
}

function validatePreferences(prefs: Preferences): void {
  if (!validZone(prefs.homeTimeZone)) throw new RangeError('Select a valid home time zone.');
  for (const value of [prefs.usualBedtime, prefs.usualWakeTime, prefs.preferredBedtime, prefs.preferredWakeTime]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new RangeError('Use valid 24-hour sleep and wake times.');
  }
  if (!Number.isFinite(prefs.sleepHours) || prefs.sleepHours < 4 || prefs.sleepHours > 12) {
    throw new RangeError('Sleep duration must be between 4 and 12 hours.');
  }
  if (!Number.isInteger(prefs.preparationDays) || prefs.preparationDays < 0 || prefs.preparationDays > 7) {
    throw new RangeError('Preparation days must be between 0 and 7.');
  }
  if (!['wake', 'bed'].includes(prefs.sleepAnchor)) throw new RangeError('Choose a sleep or wake anchor.');
  if (prefs.planningMode !== undefined && !['rules', 'model'].includes(prefs.planningMode)) throw new RangeError('Choose a supported planning mode.');
}

function subtract(range: Range, blocked: Range[]): Range[] {
  let available = [range];
  for (const block of blocked) {
    available = available.flatMap(part => {
      if (block.end <= part.start || block.start >= part.end) return [part];
      const result: Range[] = [];
      if (block.start > part.start) result.push({ start: part.start, end: block.start });
      if (block.end < part.end) result.push({ start: block.end, end: part.end });
      return result;
    });
  }
  return available.filter(part => part.end - part.start >= 15 * 60_000);
}

function targetSleep(date: string, zone: string, prefs: Preferences): Range {
  const duration = Math.round(prefs.sleepHours * HOUR);
  if (prefs.sleepAnchor === 'wake') {
    const end = clock(date, prefs.preferredWakeTime, zone);
    return { start: end - duration, end };
  }
  const start = clock(date, prefs.preferredBedtime, zone);
  return { start, end: start + duration };
}
function targetPhase(date: string, zone: string, prefs: Preferences): number {
  return wrap((targetSleep(date, zone, prefs).end - 3 * HOUR) / HOUR);
}
function homePhase(date: string, prefs: Preferences): number {
  return wrap((clock(date, prefs.usualWakeTime, prefs.homeTimeZone) - 3 * HOUR) / HOUR);
}
function phaseOccurrences(range: Range, phase: number): number[] {
  const beginning = Math.floor(range.start / DAY) * DAY;
  return [-1, 0, 1, 2].map(day => Math.round(beginning + day * DAY + phase * HOUR));
}

/**
 * A conservative rules prototype, NOT a calibrated circadian oscillator or a medical prediction.
 * Phase moves only by an assumed population pace during destination/preparation time.
 * Chronotype is context; it does not add an invented offset to habitual sleep timing.
 */
export function generateRulesPlan(trip: Trip, prefs: Preferences): Plan {
  const errors = validateTrip(trip);
  if (errors.length) throw new RangeError(errors.join('\n'));
  validatePreferences(prefs);
  const flights = trip.legs.map(leg => ({
    leg,
    departure: localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation),
    arrival: localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation),
    ...flightAirborneTiming(leg),
  }));
  const first = flights[0];
  const last = flights[flights.length - 1];
  const preparationDestination = flights.find(flight => flight.leg.stayAfter === 'destination') ?? last;
  const requestedStart = first.departure - prefs.preparationDays * DAY;
  // Preserve every flight before optional preparation/post-trip time when the trip approaches the cap.
  const horizonStart = Math.max(requestedStart, last.arrival - MAX_HORIZON);
  const horizonEnd = Math.min(horizonStart + MAX_HORIZON, last.arrival + 7 * DAY);
  const warnings = new Set<string>([
    'This is an evidence-informed rules prototype, not a clinically validated or calibrated circadian model. Adjustment and remaining shifts are planning assumptions, not measured outcomes.',
    'Biological timing is estimated from usual wake time. Even sleep diaries cannot precisely measure circadian phase; individual timing can differ by hours.',
  ]);
  if (horizonStart > requestedStart) warnings.add('Some preparation time is omitted so every flight fits inside the 90-day planning horizon.');
  if (horizonEnd < last.arrival + 7 * DAY) warnings.add('The complete plan is capped at 90 days, so some post-trip days are omitted.');
  if (prefs.sleepHours < 7) warnings.add('Most adults need at least 7 hours of sleep. Your chosen duration may leave sleep debt that timing advice cannot resolve.');
  if (prefs.melatonin && !prefs.melatoninAcknowledged) {
    warnings.add('Melatonin guidance is disabled until you acknowledge suitability and medication precautions.');
  }
  if (prefs.melatonin) {
    warnings.add('The optional 0.5–1 mg melatonin range is general CDC information, not a personal dose prescription. Guidance is omitted for delays, large uncertain shifts, flights, transfers, and daytime dosing. Never wake solely to take it.');
  }
  if (first.leg.departureTimeZone !== prefs.homeTimeZone) {
    warnings.add('The first departure is outside your home zone. This plan assumes your body clock still follows your reported home sleep schedule.');
  }
  const usualBed = clock('2025-01-01', prefs.usualBedtime, 'UTC');
  const usualWake = clock('2025-01-01', prefs.usualWakeTime, 'UTC');
  const habitualDuration = wrap((usualWake - usualBed) / HOUR);
  if (habitualDuration < 4 || habitualDuration > 12) warnings.add('Your usual sleep/wake interval is outside 4–12 hours; check the baseline used to estimate your body clock.');

  const segments: Segment[] = [];
  const firstStrategy = preparationDestination.leg.strategy;
  if (prefs.preparationDays) segments.push({
    start: horizonStart, end: first.departure - 2 * HOUR,
    zone: first.leg.departureTimeZone, stage: 'preparation', label: 'Before departure',
    strategy: firstStrategy, adapt: firstStrategy !== 'home', flight: false,
  });
  for (let index = 0; index < flights.length; index++) {
    const flight = flights[index];
    const onwards = flights[index + 1];
    if (onwards && flight.leg.arrivalAirport.toUpperCase() !== onwards.leg.departureAirport.toUpperCase()) {
      warnings.add(`A surface transfer is required between ${flight.leg.arrivalAirport} and ${onwards.leg.departureAirport}. Its timing and light/sleep constraints are unknown; review every opportunity during that gap and allow enough transfer time.`);
    }
    // Airport buffers are unavailable for sleeping, timed light, caffeine, or melatonin.
    if (flight.landing - flight.takeoff > 1.5 * HOUR) segments.push({
      start: Math.max(horizonStart, flight.takeoff + HOUR / 2), end: Math.min(horizonEnd, flight.landing - HOUR),
      zone: flight.leg.arrivalTimeZone, stage: 'travel', label: `${flight.leg.departureAirport} → ${flight.leg.arrivalAirport}`,
      strategy: 'home', adapt: false, flight: true, lieFlat: flight.leg.lieFlat === true,
    });
    const groundStart = flight.arrival + HOUR;
    const groundEnd = Math.min(horizonEnd, flights[index + 1] ? flights[index + 1].departure - 2 * HOUR : horizonEnd);
    const destination = flight.leg.stayAfter === 'destination';
    if (groundEnd > groundStart) segments.push({
      start: groundStart, end: groundEnd, zone: flight.leg.arrivalTimeZone,
      stage: destination ? (flight.leg.arrivalTimeZone === prefs.homeTimeZone ? 'home' : 'destination') : 'travel',
      label: destination ? `Stay in ${flight.leg.arrivalAirport}` : `Connection in ${flight.leg.arrivalAirport}`,
      strategy: destination ? flight.leg.strategy : 'home', adapt: destination, flight: false,
    });
    if (destination && flights[index + 1] && flights[index + 1].departure - flight.arrival < 2 * DAY && flight.leg.strategy === 'adapt') {
      warnings.add(`The stay after ${flight.leg.arrivalAirport} is under two days. Consider maintaining home time or partial adjustment if your obligations allow.`);
    }
    if (flight.arrival - flight.departure > 24 * HOUR) warnings.add(`The ${flight.leg.departureAirport} → ${flight.leg.arrivalAirport} flight exceeds 24 hours; verify the local dates.`);
  }

  const dayMap = new Map<string, PlanDay & { raw: RawAction[]; shifts: number[] }>();
  let phase = homePhase(dateInZone(horizonStart, prefs.homeTimeZone), prefs);
  let phaseUncertain = false;
  let sequence = 0;
  for (const segment of segments) {
    const segmentInitialPhase = phase;
    let partialTarget: number | undefined;
    let segmentUncertain = phaseUncertain;
    const segmentDate = dateInZone(segment.start, segment.zone);
    const firstTarget = segment.stage === 'preparation'
      ? targetPhase(dateInZone(segment.start, preparationDestination.leg.arrivalTimeZone), preparationDestination.leg.arrivalTimeZone, prefs)
      : targetPhase(segmentDate, segment.zone, prefs);
    const routeShift = neededShift(phase, segment.strategy === 'home' ? homePhase(segmentDate, prefs) : firstTarget);
    const sleepRouteShift = segment.strategy === 'partial' ? routeShift / 2 : routeShift;
    if (segment.adapt && Math.abs(routeShift) >= 8) {
      segmentUncertain = true;
      phaseUncertain = true;
      warnings.add(`A shift of ${rounded(Math.abs(routeShift))} hours around ${segment.label.toLowerCase()} has an uncertain advance/delay route. This prototype omits precise light and melatonin timing for that segment; its adjustment pace is only an assumption.`);
    }
    if (phaseUncertain) warnings.add('After a large uncertain shift, precise light and melatonin timing remain omitted at later stops. Assumed progress cannot establish your actual body-clock phase.');
    if (segment.strategy === 'partial') partialTarget = wrap(phase - routeShift / 2);
    for (const piece of pieces(segment)) {
      const key = `${piece.date}:${piece.zone}`;
      let day = dayMap.get(key);
      if (!day) {
        day = { id: key, date: piece.date, timeZone: piece.zone, label: piece.label, stage: piece.stage,
          actions: [], phaseShiftHours: 0, remainingShiftHours: 0, note: '', raw: [], shifts: [] };
        dayMap.set(key, day);
      }
      const target = segment.stage === 'preparation' && segment.strategy !== 'home'
        ? targetPhase(dateInZone(piece.start, preparationDestination.leg.arrivalTimeZone), preparationDestination.leg.arrivalTimeZone, prefs)
        : segment.strategy === 'home' ? homePhase(piece.date, prefs) : partialTarget ?? targetPhase(piece.date, piece.zone, prefs);
      const remaining = neededShift(phase, target);
      // Only elapsed ground time contributes to assumed progress; connections and flights keep continuity.
      const rate = segment.stage === 'preparation' || remaining >= 0 ? 1 : 1.5;
      const progress = segment.adapt ? Math.sign(remaining) * Math.min(Math.abs(remaining), rate * (piece.end - piece.start) / DAY) : 0;
      const centerPhase = wrap(phase - progress / 2);
      const endPhase = wrap(phase - progress);
      day.shifts.push(progress);
      day.phaseShiftHours = rounded(day.shifts.reduce((sum, value) => sum + value, 0));
      day.remainingShiftHours = rounded(Math.abs(neededShift(endPhase, target)));
      const note = segment.flight ? 'Sleep starts at least 30 minutes after takeoff and ends at least 60 minutes before landing.'
        : segment.strategy === 'partial' ? 'Partial adjustment aims halfway toward this destination; actual adjustment may differ.'
        : segment.strategy === 'home' ? 'Keep your usual home-time sleep pattern where practical; the body-clock estimate carries forward from earlier stops.'
        : 'Adjustment assumes at most 1 hour/day earlier or 1.5 hours/day later while on the ground; this is not a prediction of your response.';
      if (!day.note.includes(note)) day.note = [day.note, note].filter(Boolean).join(' ');
      if (segmentUncertain) day.note += ' Precise phase interventions are omitted because a large shift makes the estimated phase uncertain.';
      if (segment.stage === 'preparation') day.note += ' Preparation is optional and moves at most 1 hour/day; preserve your sleep duration.';

      const add = (type: PlanAction['type'], range: Range, title: string, detail: string, reason: string, evidenceUrl = CDC, dose?: string) => {
        const start = Math.max(piece.start, range.start);
        const end = Math.min(piece.end, range.end);
        if (end - start < 15 * 60_000) return;
        day!.raw.push({ id: `${trip.id}-${sequence++}`, type, start: iso(start), end: iso(end),
          timeZone: piece.zone, title, detail, reason, evidenceUrl, ...(dose ? { dose } : {}), startMs: start, endMs: end });
      };

      let sleeps: Range[];
      if (!segment.flight && segment.strategy === 'adapt' && segment.stage !== 'preparation') {
        sleeps = [-1, 0, 1].map(offset => targetSleep(plusDate(piece.date, offset), piece.zone, prefs));
      } else {
        // Preparation, partial adjustment, connections, and home-time strategies follow the evolving estimate.
        // Each night uses one phase estimate across display-day boundaries, preserving duration.
        sleeps = phaseOccurrences(piece, segmentInitialPhase).map(baselineMinimum => {
          const elapsedDays = Math.max(0, baselineMinimum - segment.start) / DAY;
          const sleepProgress = segment.adapt
            ? Math.sign(sleepRouteShift) * Math.min(Math.abs(sleepRouteShift), (segment.stage === 'preparation' || sleepRouteShift >= 0 ? 1 : 1.5) * elapsedDays)
            : 0;
          const minimum = Math.round(baselineMinimum - sleepProgress * HOUR);
          return { start: Math.round(minimum + (3 - prefs.sleepHours) * HOUR), end: minimum + 3 * HOUR };
        });
      }
      const boundedSleeps = sleeps.map(sleep => ({ start: Math.max(piece.start, sleep.start), end: Math.min(piece.end, sleep.end) }))
        .filter(sleep => sleep.end - sleep.start >= (segment.flight ? 30 : 15) * 60_000);
      for (const sleep of boundedSleeps) add('sleep', sleep, segment.flight && !segment.lieFlat ? 'Rest or nap' : 'Bedtime',
        segment.flight ? (segment.lieFlat
          ? 'A lie-flat bed can make sleep more comfortable. Sleep starts at least 30 minutes after takeoff and ends at least 60 minutes before landing.'
          : 'Rest or nap as your seat allows. An eye mask, earplugs and head support may help. Rest starts at least 30 minutes after takeoff and ends at least 60 minutes before landing.')
          : `Aim for ${prefs.sleepHours} hours of sleep.`,
        'Protect sleep while gradually aligning the schedule. Travel fatigue and sleep debt also affect how you feel.');

      if (!segment.flight && !segmentUncertain && Math.abs(remaining) >= 0.5 && segment.adapt) {
        const advance = remaining > 0;
        for (const minimum of phaseOccurrences(piece, centerPhase)) {
          const before = { start: minimum - 5 * HOUR, end: minimum - 2 * HOUR };
          const after = { start: minimum + 2 * HOUR, end: minimum + 5 * HOUR };
          const seek = advance ? after : before;
          const avoid = advance ? before : after;
          for (const range of subtract(seek, boundedSleeps)) add('light', range, 'Seek bright light',
            'Get outdoor daylight when available. If it is dark, ordinary bright indoor light is an alternative with less certain effect. Never stare at the sun.',
            `Light ${advance ? 'after' : 'before'} the estimated biological low point tends to shift the clock ${advance ? 'earlier' : 'later'}. The window includes a buffer around uncertain phase timing.`, LIGHT_PRC);
          for (const range of subtract(avoid, boundedSleeps)) add('avoid-light', range, 'Keep light low',
            'Use dim indoor lighting and reduce screen brightness. Avoidance is optional when incompatible with safe navigation, driving, work, or airport instructions.',
            `Light ${advance ? 'before' : 'after'} the estimated biological low point can push the clock in the opposite direction.`, LIGHT_PRC);
        }
      }
      if (prefs.caffeine && !segment.flight) {
        for (const sleep of sleeps) add('caffeine', { start: sleep.end, end: sleep.end + 2 * HOUR },
          'Optional caffeine', 'Use your usual modest amount for alertness only. This window stops at least 8 hours before any planned sleep; skip it if you are sensitive or avoiding caffeine.',
          'Caffeine can support alertness but does not substitute for sleep and can delay sleep or the body clock.');
      }
      if (prefs.melatonin && prefs.melatoninAcknowledged && !segment.flight && !segmentUncertain && segment.adapt && remaining >= 1) {
        for (const sleep of sleeps) {
          const candidate = sleep.start - HOUR;
          const localHour = Temporal.Instant.fromEpochMilliseconds(candidate).toZonedDateTimeISO(piece.zone).hour;
          const biologicalHoursAfterMinimum = wrap(candidate / HOUR - centerPhase);
          // Bedtime ground use only, with broad phase compatibility; never prescribe daytime/morning sedation.
          if (candidate >= piece.start && sleep.start <= piece.end && sleep.end <= segment.end && localHour >= 18 && biologicalHoursAfterMinimum >= 11 && biologicalHoursAfterMinimum <= 16.5) {
            add('melatonin', { start: candidate, end: candidate + 15 * 60_000 }, 'Optional melatonin before sleep',
              'If suitable for you, the CDC describes 0.5–1 mg as often sufficient for a circadian shift. This is general information, not a personalized dose. Skip if driving, doing alertness-critical tasks, or unable to sleep soon. Do not take an extra dose or wake to take it.',
              'An optional ground bedtime window is included only when broad estimated biological timing supports an advance. Optimal individual timing is not measured.', CDC, '0.5–1 mg · general information');
          }
        }
      }
      phase = endPhase;
    }
  }

  // Global conflict resolution includes sleep that crosses a date, segment, or timezone boundary.
  const allSleep = [...dayMap.values()].flatMap(day => day.raw.filter(action => action.type === 'sleep').map(action => ({ start: action.startMs, end: action.endMs })));
  const sleepAndCutoffs = allSleep.map(sleep => ({ start: sleep.start - 8 * HOUR, end: sleep.end }));
  const days = [...dayMap.values()].map(({ raw, shifts: _shifts, ...day }) => {
    const actions: PlanAction[] = raw.flatMap(action => {
      const blocks = action.type === 'caffeine' ? sleepAndCutoffs : action.type === 'light' || action.type === 'avoid-light' || action.type === 'melatonin' ? allSleep : [];
      return subtract({ start: action.startMs, end: action.endMs }, blocks).map(range => {
        const { startMs: _startMs, endMs: _endMs, ...plain } = action;
        return { ...plain, id: `${plain.id}-${range.start}`, start: iso(range.start), end: iso(range.end) };
      });
    }).sort((a, b) => a.start.localeCompare(b.start) || a.type.localeCompare(b.type));
    return { ...day, actions };
  }).sort((a, b) => clock(a.date, '00:00', a.timeZone) - clock(b.date, '00:00', b.timeZone));

  if (!days.some(day => day.actions.some(action => action.type === 'sleep'))) warnings.add('No protected main sleep opportunity fits this itinerary. Review the plan around transfers and allow recovery sleep.');
  return {
    version: PLAN_VERSION, tripId: trip.id, generatedAt: new Date().toISOString(), days,
    warnings: [...warnings],
    summary: {
      destinations: trip.legs.filter(leg => leg.stayAfter === 'destination').length,
      flightHours: rounded(flights.reduce((sum, flight) => sum + (flight.arrival - flight.departure) / HOUR, 0)),
      timeZoneChanges: trip.legs.filter(leg => leg.departureTimeZone !== leg.arrivalTimeZone).length,
    },
  };
}

/** Gate schedule and airborne schedule are different: default taxi allowances are conservative estimates. */
export function flightAirborneTiming(leg: Trip['legs'][number]): { takeoff: number; landing: number } {
  const departure = localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation);
  const arrival = localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation);
  return {
    takeoff: leg.takeoffDateTime ? localToInstant(leg.takeoffDateTime, leg.departureTimeZone, leg.departureDisambiguation) : departure + (leg.taxiOutMinutes ?? 30) * 60_000,
    landing: leg.landingDateTime ? localToInstant(leg.landingDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation) : arrival - (leg.taxiInMinutes ?? 30) * 60_000,
  };
}

/** Newly generated plans use the numerical model; the original rules remain an explicit fallback. */
export function generatePlan(trip: Trip, prefs: Preferences, options?: ModelPlanOptions): Plan {
  const errors = validateTrip(trip);
  if (errors.length) throw new RangeError(errors.join('\n'));
  validatePreferences(prefs);
  return decoratePlanWithMeals(decoratePlanWithTravel(prefs.planningMode === 'rules' ? generateRulesPlan(trip, prefs) : generateModelPlan(trip, prefs, options), trip), trip);
}
