import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import { buildDayTimeline, timelineActionKind } from '../src/lib/day-timeline';
import { generatePlan } from './support/planning';
import { groupPlanDays } from '../src/lib/plan-calendar';
import type { LoungeFlightContext } from '../src/lib/lounge-windows';
import type { ActionType, PlanAction, PlanDay, PlanTravelSegment, Trip } from '../src/lib/types';
import octoberItinerary from './fixtures/itineraries/oct2026.json';

const instant = (value: string) => Date.parse(value);
const action = (
  id: string,
  type: ActionType,
  start: string,
  end: string,
  changes: Partial<PlanAction> = {},
): PlanAction => ({
  id,
  type,
  start,
  end,
  timeZone: 'UTC',
  title: type === 'sleep' ? 'Bedtime' : type,
  detail: 'Original advice',
  reason: 'Original reason',
  ...changes,
});
const day = (date = '2026-10-20', timeZone = 'UTC', changes: Partial<PlanDay> = {}): PlanDay => ({
  id: `${date}:${timeZone}`,
  date,
  timeZone,
  stage: 'destination',
  label: 'Stay in San Francisco',
  actions: [],
  phaseShiftHours: 0.3,
  remainingShiftHours: 2,
  note: '',
  ...changes,
});
const flight: PlanTravelSegment = {
  id: 'qf103',
  flightNumber: 'QF103',
  departureAirport: 'SYD',
  arrivalAirport: 'HNL',
  departure: '2026-10-17T09:15:00.000Z',
  arrival: '2026-10-17T18:55:00.000Z',
  departureTimeZone: 'Australia/Sydney',
  arrivalTimeZone: 'Pacific/Honolulu',
};

describe('daily chronological timeline', () => {
  it('preserves overlapping advice and derives only the gaps outside recommended sleep and rest', () => {
    const actions = [
      action('bedtime', 'sleep', '2026-10-20T22:00:00Z', '2026-10-21T00:00:00Z'),
      action('light', 'light', '2026-10-20T06:00:00Z', '2026-10-20T10:00:00Z'),
      action('caffeine', 'caffeine', '2026-10-20T06:00:00Z', '2026-10-20T08:00:00Z'),
      action('nap', 'sleep', '2026-10-20T13:00:00Z', '2026-10-20T14:00:00Z', {
        title: 'Rest or nap',
        sleepKind: 'rest',
      }),
      action('melatonin', 'melatonin', '2026-10-20T21:45:00Z', '2026-10-20T22:00:00Z'),
      action('dark', 'avoid-light', '2026-10-20T20:00:00Z', '2026-10-20T23:00:00Z'),
      action('overnight', 'sleep', '2026-10-20T00:00:00Z', '2026-10-20T06:00:00Z'),
    ];
    const [calendar] = groupPlanDays([day(undefined, undefined, { actions })]);
    const before = JSON.stringify(calendar);
    const timeline = buildDayTimeline(calendar);

    expect(timeline.entries.map((entry) => entry.id)).toEqual([
      'overnight',
      'caffeine',
      'light',
      'nap',
      'dark',
      'melatonin',
      'bedtime',
    ]);
    for (const entry of timeline.entries) {
      expect(entry.kind).toBe('action');
      if (entry.kind === 'action')
        expect(entry.action).toBe(actions.find((original) => original.id === entry.id));
    }
    expect(
      timeline.bands.filter((band) => band.kind === 'awake').map((band) => [band.start, band.end]),
    ).toEqual([
      [instant('2026-10-20T06:00:00Z'), instant('2026-10-20T13:00:00Z')],
      [instant('2026-10-20T14:00:00Z'), instant('2026-10-20T22:00:00Z')],
    ]);
    expect(timeline.bands.find((band) => band.id === 'action:nap')?.kind).toBe('rest');
    const caffeine = timeline.bands.find((band) => band.id === 'action:caffeine')!;
    const light = timeline.bands.find((band) => band.id === 'action:light')!;
    const darkness = timeline.bands.find((band) => band.id === 'action:dark')!;
    const bedtime = timeline.bands.find((band) => band.id === 'action:bedtime')!;
    expect(caffeine.start).toBe(light.start);
    expect(caffeine.end - caffeine.start).toBe(2 * 3_600_000);
    expect(light.end - light.start).toBe(4 * 3_600_000);
    expect(darkness.end).toBeGreaterThan(bedtime.start);
    expect(JSON.stringify(calendar)).toBe(before);
  });

  it('clips cross-midnight intervals without changing original IDs, times or adherence references', () => {
    const previous = action(
      'previous-sleep',
      'sleep',
      '2026-10-19T23:00:00Z',
      '2026-10-20T02:00:00Z',
    );
    const next = action('next-sleep', 'sleep', '2026-10-20T23:00:00Z', '2026-10-21T07:00:00Z');
    const [calendar] = groupPlanDays([day(undefined, undefined, { actions: [next, previous] })]);
    const timeline = buildDayTimeline(calendar);
    expect(timeline.start).toBe(instant('2026-10-20T00:00:00Z'));
    expect(timeline.end).toBe(instant('2026-10-21T00:00:00Z'));
    expect(timeline.entries[0]).toMatchObject({
      id: previous.id,
      action: previous,
      start: timeline.start,
      end: instant('2026-10-20T02:00:00Z'),
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(timeline.entries[1]).toMatchObject({
      id: next.id,
      action: next,
      start: instant('2026-10-20T23:00:00Z'),
      end: timeline.end,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(previous.start).toBe('2026-10-19T23:00:00Z');
    expect(next.end).toBe('2026-10-21T07:00:00Z');
  });

  it.each([
    ['2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23],
    ['2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25],
  ])('uses the real %s New York day rather than assuming 24 hours', (date, start, end, hours) => {
    const [calendar] = groupPlanDays([day(date, 'America/New_York')]);
    const timeline = buildDayTimeline(calendar);
    expect(timeline.start).toBe(instant(start));
    expect(timeline.end).toBe(instant(end));
    expect(timeline.end - timeline.start).toBe(Number(hours) * 3_600_000);
  });

  it('orders repeated 01:30 recommendations by UTC through a daylight-saving fold', () => {
    const first = action('earlier', 'light', '2026-11-01T05:30:00Z', '2026-11-01T05:45:00Z', {
      timeZone: 'America/New_York',
    });
    const second = action('later', 'caffeine', '2026-11-01T06:30:00Z', '2026-11-01T06:45:00Z', {
      timeZone: 'America/New_York',
    });
    const [calendar] = groupPlanDays([
      day('2026-11-01', 'America/New_York', { actions: [second, first] }),
    ]);
    const timeline = buildDayTimeline(calendar);
    expect(timeline.entries.map((entry) => entry.id)).toEqual(['earlier', 'later']);
    expect(timeline.entries[1].start - timeline.entries[0].start).toBe(3_600_000);
  });

  it('retains the Sydney departure before Honolulu midnight on the single date-line day', () => {
    const origin = action('origin', 'sleep', '2026-10-17T02:00:00Z', '2026-10-17T03:00:00Z', {
      timeZone: 'Australia/Sydney',
    });
    const destination = action(
      'destination',
      'sleep',
      '2026-10-18T07:00:00Z',
      '2026-10-18T10:00:00Z',
      { timeZone: 'Pacific/Honolulu' },
    );
    const [calendar] = groupPlanDays([
      day('2026-10-17', 'Australia/Sydney', { actions: [origin], travelSegments: [flight] }),
      day('2026-10-17', 'Pacific/Honolulu', { actions: [destination], travelSegments: [flight] }),
    ]);
    expect(calendar.timeZone).toBe('Pacific/Honolulu');
    const timeline = buildDayTimeline(calendar);
    expect(timeline.start).toBe(instant('2026-10-16T13:00:00Z'));
    expect(timeline.end).toBe(instant('2026-10-18T10:00:00Z'));
    expect(
      timeline.entries
        .filter((entry) => entry.kind !== 'flight' || entry.phase !== 'arrival')
        .map((entry) => entry.id),
    ).toEqual(['origin', 'qf103', 'destination']);
    expect(timeline.entries[1]).toMatchObject({
      kind: 'flight',
      flight,
      start: instant(flight.departure),
      end: instant(flight.arrival),
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('keeps a midnight arrival card on the arrival date without inventing flight duration', () => {
    const midnightFlight: PlanTravelSegment = {
      ...flight,
      departure: '2026-10-19T22:00:00Z',
      arrival: '2026-10-20T00:00:00Z',
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'UTC',
    };
    const [calendar] = groupPlanDays([
      day(undefined, undefined, { travelSegments: [midnightFlight] }),
    ]);
    const timeline = buildDayTimeline(calendar);
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]).toMatchObject({
      kind: 'flight',
      phase: 'arrival',
      flight: midnightFlight,
      start: timeline.start,
      end: timeline.start,
    });
    expect(timeline.bands.some((band) => band.kind === 'flight')).toBe(false);
  });

  it('keeps an empty day readable and skips invalid or zero-length records', () => {
    const invalidActions = [
      action('invalid-date', 'light', 'invalid', '2026-10-20T10:00:00Z'),
      action('zero', 'sleep', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z'),
      action('reversed', 'caffeine', '2026-10-20T12:00:00Z', '2026-10-20T10:00:00Z'),
    ];
    const invalidFlight = { ...flight, departure: 'invalid' };
    const [calendar] = groupPlanDays([
      day(undefined, undefined, { actions: invalidActions, travelSegments: [invalidFlight] }),
    ]);
    const timeline = buildDayTimeline(calendar);
    expect(timeline.entries).toEqual([]);
    expect(timeline.bands).toEqual([
      {
        id: `awake:${timeline.start}`,
        kind: 'awake',
        start: timeline.start,
        end: timeline.end,
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
    expect(calendar.actions).toHaveLength(3);
    expect(calendar.travelSegments[0]).toBe(invalidFlight);
  });

  it('keeps date-line days continuous and preserves every flight minute and original action', () => {
    const plan = generatePlan(octoberItinerary.trip as Trip, {
      ...DEFAULT_PREFERENCES,
      homeTimeZone: 'Australia/Sydney',
      preparationDays: 3,
      planningMode: 'rules',
    });
    const calendars = groupPlanDays(plan.days);
    const original = new Map(
      plan.days.flatMap((source) => source.actions).map((value) => [value.id, value]),
    );
    const timelines = calendars.map((calendar) => buildDayTimeline(calendar));
    const presented = timelines
      .flatMap((timeline) => timeline.entries)
      .filter((entry) => entry.kind === 'action');
    expect(new Set(presented.map((entry) => entry.id))).toEqual(new Set(original.keys()));
    for (const entry of presented)
      if (entry.kind === 'action') expect(entry.action).toBe(original.get(entry.id));
    for (const timeline of timelines) {
      for (const band of timeline.bands) {
        expect(band.start).toBeGreaterThanOrEqual(timeline.start);
        expect(band.end).toBeLessThanOrEqual(timeline.end);
        expect(band.end).toBeGreaterThanOrEqual(band.start);
      }
      for (let i = 1; i < timeline.entries.length; i++)
        expect(timeline.entries[i].start).toBeGreaterThanOrEqual(timeline.entries[i - 1].start);
    }
    for (let index = 1; index < timelines.length; index++)
      expect(timelines[index].start).toBe(timelines[index - 1].end);
    const flights = new Map(
      calendars.flatMap((calendar) =>
        calendar.travelSegments.map((flight) => [flight.id, flight] as const),
      ),
    );
    for (const flight of flights.values()) {
      const portions = timelines.flatMap((timeline) =>
        timeline.bands.filter((band) => band.kind === 'flight' && band.flight?.id === flight.id),
      );
      expect(portions.reduce((total, band) => total + band.end - band.start, 0)).toBe(
        instant(flight.arrival) - instant(flight.departure),
      );
      for (let index = 1; index < portions.length; index++)
        expect(portions[index].start).toBe(portions[index - 1].end);
    }
    // A clock change cannot turn sleep already recommended elsewhere in the
    // journey into an Awake band on another date's view of the same instant.
    for (const awake of timelines
      .flatMap((timeline) => timeline.bands)
      .filter((band) => band.kind === 'awake'))
      for (const sleep of [...original.values()].filter((value) => value.type === 'sleep'))
        expect(awake.start < instant(sleep.end) && awake.end > instant(sleep.start)).toBe(false);
    const timelineOnDate = (date: string) =>
      timelines[calendars.findIndex((calendar) => calendar.date === date)];
    expect(timelineOnDate('2026-10-24').end).toBe(instant('2026-10-25T06:40:00Z'));
    expect(timelineOnDate('2026-10-25').start).toBe(instant('2026-10-25T06:40:00Z'));
    expect(timelineOnDate('2026-10-25').end).toBe(instant('2026-10-25T13:00:00Z'));
    expect(timelineOnDate('2026-10-26').start).toBe(instant('2026-10-25T13:00:00Z'));
    expect(
      timelineOnDate('2026-10-25').bands.some((band) => band.flight?.flightNumber === 'AA6276'),
    ).toBe(false);
    const flightOnDate = (date: string) =>
      timelines[calendars.findIndex((calendar) => calendar.date === date)].entries.find(
        (entry) => entry.kind === 'flight' && entry.flight.flightNumber === 'QF94',
      );
    expect(flightOnDate('2026-10-24')).toMatchObject({
      phase: 'departure',
      continuesBefore: false,
      continuesAfter: true,
    });
    // The destination clock starts at departure, without replaying Pacific
    // preflight hours or counting the flight's first twenty minutes twice.
    expect(flightOnDate('2026-10-25')).toMatchObject({
      phase: 'continuation',
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(flightOnDate('2026-10-26')).toMatchObject({
      phase: 'continuation',
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(
      timelineOnDate('2026-10-26').entries.find(
        (entry) =>
          entry.kind === 'flight' &&
          entry.phase === 'arrival' &&
          entry.flight.flightNumber === 'QF94',
      ),
    ).toMatchObject({
      start: instant('2026-10-25T22:30:00Z'),
      end: instant('2026-10-25T22:30:00Z'),
    });
  });

  it('presents midnight sleep fragments as one episode without changing recorded action references', () => {
    const returnFlight: PlanTravelSegment = {
      ...flight,
      id: 'qf94',
      flightNumber: 'QF94',
      departureAirport: 'LAX',
      arrivalAirport: 'MEL',
      departure: '2026-10-25T06:40:00Z',
      arrival: '2026-10-25T22:30:00Z',
      departureTimeZone: 'America/Los_Angeles',
      arrivalTimeZone: 'Australia/Melbourne',
    };
    const firstRest = action('rest-25', 'sleep', '2026-10-25T11:15:00Z', '2026-10-25T13:00:00Z', {
      timeZone: 'Australia/Melbourne',
      sleepKind: 'rest',
      title: 'Rest or nap',
    });
    const nextRest = {
      ...firstRest,
      id: 'rest-26',
      start: firstRest.end,
      end: '2026-10-25T19:15:00Z',
    };
    const firstNight = action(
      'bedtime-26',
      'sleep',
      '2026-10-26T12:00:00Z',
      '2026-10-26T13:00:00Z',
      {
        timeZone: 'Australia/Melbourne',
        sleepKind: 'sleep',
      },
    );
    const nextNight = {
      ...firstNight,
      id: 'bedtime-27',
      start: firstNight.end,
      end: '2026-10-26T20:00:00Z',
    };
    const calendars = groupPlanDays([
      day('2026-10-24', 'America/Los_Angeles', { travelSegments: [returnFlight] }),
      day('2026-10-25', 'Australia/Melbourne', {
        actions: [firstRest],
        travelSegments: [returnFlight],
      }),
      day('2026-10-26', 'Australia/Melbourne', {
        actions: [nextRest, firstNight],
        travelSegments: [returnFlight],
      }),
      day('2026-10-27', 'Australia/Melbourne', { actions: [nextNight] }),
    ]);
    const entries = calendars.flatMap((calendar) => buildDayTimeline(calendar).entries);
    const entryFor = (original: PlanAction) => entries.find((entry) => entry.id === original.id)!;
    expect(entryFor(firstRest)).toMatchObject({
      action: firstRest,
      sleepEpisode: {
        start: instant(firstRest.start),
        end: instant(nextRest.end),
        continuesBefore: false,
        continuesAfter: true,
      },
    });
    expect(entryFor(nextRest)).toMatchObject({
      action: nextRest,
      sleepEpisode: {
        start: instant(firstRest.start),
        end: instant(nextRest.end),
        continuesBefore: true,
        continuesAfter: false,
      },
    });
    expect(entryFor(firstNight)).toMatchObject({
      action: firstNight,
      sleepEpisode: {
        start: instant(firstNight.start),
        end: instant(nextNight.end),
        continuesBefore: false,
        continuesAfter: true,
      },
    });
    expect(entryFor(nextNight)).toMatchObject({
      action: nextNight,
      sleepEpisode: {
        start: instant(firstNight.start),
        end: instant(nextNight.end),
        continuesBefore: true,
        continuesAfter: false,
      },
    });
    for (const original of [firstRest, nextRest, firstNight, nextNight]) {
      const entry = entryFor(original);
      expect(entry.kind === 'action' && entry.action).toBe(original);
    }
  });

  it('deduplicates repeated IDs, keeps same-instant entries deterministic, and distinguishes rest from sleep', () => {
    const first = action('a', 'light', '2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z');
    const second = action('b', 'caffeine', first.start, first.end);
    const concurrentFlight: PlanTravelSegment = {
      ...flight,
      departure: first.start,
      arrival: first.end,
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'UTC',
    };
    const [calendar] = groupPlanDays([
      day(undefined, undefined, { actions: [second, first], travelSegments: [concurrentFlight] }),
    ]);
    calendar.actions.push(first);
    calendar.travelSegments.push(concurrentFlight);
    const entries = buildDayTimeline(calendar).entries;
    expect(
      entries
        .filter((entry) => entry.kind !== 'flight' || entry.phase !== 'arrival')
        .map((entry) => entry.id),
    ).toEqual(['qf103', 'a', 'b']);
    expect(
      entries.filter((entry) => entry.kind === 'flight' && entry.phase === 'arrival'),
    ).toHaveLength(1);
    expect(timelineActionKind(first)).toBe('light');
    expect(
      timelineActionKind({ ...first, type: 'sleep', title: 'Bedtime', sleepKind: 'rest' }),
    ).toBe('rest');
    expect(
      timelineActionKind({ ...first, type: 'sleep', title: 'Rest or nap', sleepKind: 'sleep' }),
    ).toBe('sleep');
    expect(timelineActionKind({ ...first, type: 'sleep', title: 'Bedtime' })).toBe('sleep');
  });
});

describe('pre-flight lounge timeline events', () => {
  const context = (changes: Partial<LoungeFlightContext> = {}): LoungeFlightContext => ({
    id: 'qf103:pre-flight',
    legId: flight.id,
    airport: 'SYD',
    kind: 'pre-flight',
    departure: flight.departure,
    timeZone: flight.departureTimeZone,
    flightNumber: flight.flightNumber,
    destinationAirport: 'HNL',
    travelClass: 'economy',
    windowStatus: 'estimated',
    start: '2026-10-17T06:15:00Z',
    end: '2026-10-17T08:30:00Z',
    minutes: 135,
    note: '',
    ...changes,
  });

  it('places a date-line pre-flight prompt before takeoff without moving the flight or model actions', () => {
    const recommendation = action(
      'light',
      'light',
      '2026-10-17T04:00:00Z',
      '2026-10-17T05:00:00Z',
      {
        timeZone: 'Australia/Sydney',
      },
    );
    const [calendar] = groupPlanDays([
      day('2026-10-17', 'Australia/Sydney', {
        actions: [recommendation],
        travelSegments: [flight],
      }),
      day('2026-10-17', 'Pacific/Honolulu', { travelSegments: [flight] }),
    ]);
    const before = JSON.stringify(calendar);
    const lounge = context();
    const timeline = buildDayTimeline(calendar, { loungeContexts: [lounge] });
    const prompt = timeline.entries.find((entry) => entry.kind === 'lounge')!;
    const departure = timeline.entries.find((entry) => entry.kind === 'flight')!;
    expect(prompt).toMatchObject({
      start: instant(lounge.start!),
      end: instant(lounge.start!),
      lounge,
    });
    expect(prompt.start).toBeLessThan(departure.start);
    expect(departure.start).toBe(instant(flight.departure));
    expect(timeline.bands.find((band) => band.kind === 'flight')?.start).toBe(
      instant(flight.departure),
    );
    expect(timeline.bands.some((band) => band.id.includes('lounge'))).toBe(false);
    expect(timeline.entries.find((entry) => entry.kind === 'action')?.action).toBe(recommendation);
    expect(JSON.stringify(calendar)).toBe(before);
  });

  it.each(['limited', 'unavailable', 'unknown'] as const)(
    'retains a quiet pre-flight prompt for a %s visit without inventing a lounge duration',
    (windowStatus) => {
      const [calendar] = groupPlanDays([
        day('2026-10-17', 'Australia/Sydney', { travelSegments: [flight] }),
      ]);
      const lounge = context({
        windowStatus,
        start: undefined,
        end: undefined,
        minutes: undefined,
      });
      const prompt = buildDayTimeline(calendar, { loungeContexts: [lounge] }).entries.find(
        (entry) => entry.kind === 'lounge',
      )!;
      expect(prompt.start).toBe(instant(flight.departure) - 30 * 60_000);
      expect(prompt.end).toBe(prompt.start);
      expect(prompt.kind === 'lounge' && prompt.lounge).toBe(lounge);
      expect(lounge.start).toBeUndefined();
    },
  );

  it('orders same-instant action and lounge entries consistently regardless of action input order', () => {
    const lounge = context();
    const light = action('light', 'light', lounge.start!, '2026-10-17T07:00:00Z', {
      timeZone: 'Australia/Sydney',
    });
    const caffeine = { ...light, id: 'caffeine', type: 'caffeine' as const };
    const ordered = (actions: PlanAction[]) => {
      const [calendar] = groupPlanDays([
        day('2026-10-17', 'Australia/Sydney', { actions, travelSegments: [flight] }),
      ]);
      return buildDayTimeline(calendar, { loungeContexts: [lounge] })
        .entries.filter((entry) => entry.kind !== 'flight' || entry.phase !== 'arrival')
        .map((entry) => entry.id);
    };
    expect(ordered([light, caffeine])).toEqual(['lounge:qf103', 'caffeine', 'light', 'qf103']);
    expect(ordered([caffeine, light])).toEqual(ordered([light, caffeine]));
  });

  it('extends a midnight departure tile to the previous evening and omits prompts on continuation days', () => {
    const overnight: PlanTravelSegment = {
      ...flight,
      departure: '2026-10-25T08:00:00Z',
      arrival: '2026-10-25T23:30:00Z',
      departureAirport: 'LAX',
      arrivalAirport: 'MEL',
      departureTimeZone: 'America/Los_Angeles',
      arrivalTimeZone: 'Australia/Melbourne',
    };
    const lounge = context({
      departure: overnight.departure,
      airport: 'LAX',
      destinationAirport: 'MEL',
      kind: 'transit',
      timeZone: overnight.departureTimeZone,
      start: '2026-10-25T05:40:00Z',
      end: '2026-10-25T07:15:00Z',
    });
    const [departure] = groupPlanDays([
      day('2026-10-25', 'America/Los_Angeles', { travelSegments: [overnight] }),
    ]);
    const [arrival] = groupPlanDays([
      day('2026-10-26', 'Australia/Melbourne', { travelSegments: [overnight] }),
    ]);
    const timeline = buildDayTimeline(departure, { loungeContexts: [lounge] });
    expect(timeline.start).toBeLessThanOrEqual(instant(lounge.start!));
    expect(timeline.entries[0].kind).toBe('lounge');
    expect(timeline.entries[0].start).toBe(instant(lounge.start!));
    expect(timeline.entries[1].start).toBe(instant(overnight.departure));
    expect(
      buildDayTimeline(arrival, { loungeContexts: [lounge] }).entries.some(
        (entry) => entry.kind === 'lounge',
      ),
    ).toBe(false);
  });
});
