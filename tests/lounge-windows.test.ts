import { describe, expect, it } from 'vitest';
import { airportCountry, buildFlightLoungeContexts, buildLoungeOpportunities } from '../src/lib/lounge-windows';
import type { FlightLeg, Trip } from '../src/lib/types';
import octoberItinerary from './fixtures/itineraries/oct2026.json';

const leg = (changes: Partial<FlightLeg> = {}): FlightLeg => ({
  id: 'outbound', flightNumber: 'QF103', departureAirport: 'SYD', arrivalAirport: 'HNL',
  departureDateTime: '2026-10-17T10:00', arrivalDateTime: '2026-10-17T00:30',
  departureTimeZone: 'Australia/Sydney', arrivalTimeZone: 'Pacific/Honolulu',
  stayAfter: 'destination', strategy: 'adapt', ...changes,
});
const trip = (legs: FlightLeg[]): Trip => ({
  id: 'trip', name: 'Airport visits', legs,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
});
const domestic = (changes: Partial<FlightLeg> = {}): FlightLeg => leg({
  flightNumber: 'AA1', departureAirport: 'SFO', arrivalAirport: 'LAX',
  departureDateTime: '2026-10-17T10:00', arrivalDateTime: '2026-10-17T11:30',
  departureTimeZone: 'America/Los_Angeles', arrivalTimeZone: 'America/Los_Angeles', ...changes,
});
const onward = (changes: Partial<FlightLeg> = {}): FlightLeg => domestic({
  id: 'onward', flightNumber: 'QF94', departureAirport: 'LAX', arrivalAirport: 'MEL',
  departureDateTime: '2026-10-17T16:00', arrivalDateTime: '2026-10-19T00:30',
  arrivalTimeZone: 'Australia/Melbourne', ...changes,
});

describe('airport lounge visit opportunities', () => {
  it('offers an assumed international pre-flight visit in UTC with the saved cabin', () => {
    expect(buildLoungeOpportunities(trip([leg({ travelClass: 'business' })]))).toEqual([{
      id: 'outbound:pre-flight', legId: 'outbound', airport: 'SYD', kind: 'pre-flight',
      start: '2026-10-16T20:00:00.000Z', end: '2026-10-16T22:15:00.000Z',
      departure: '2026-10-16T23:00:00.000Z', timeZone: 'Australia/Sydney',
      flightNumber: 'QF103', destinationAirport: 'HNL', travelClass: 'business', minutes: 135,
      note: 'Assumes airport arrival 3 hours before departure; adjust the visit time in Lounge Explorer. Leaves 45 minutes for boarding.',
    }]);
  });

  it('uses shorter domestic arrival and boarding buffers without treating Hawaii as international', () => {
    const result = buildLoungeOpportunities(trip([domestic({
      departureAirport: ' hnl ', arrivalAirport: 'sfo',
      departureTimeZone: 'Pacific/Honolulu', arrivalTimeZone: 'America/Los_Angeles',
      departureDateTime: '2026-10-17T10:00', arrivalDateTime: '2026-10-17T18:00',
    })]));
    expect(result[0]).toMatchObject({ airport: 'HNL', destinationAirport: 'SFO', minutes: 90,
      start: '2026-10-17T18:00:00.000Z', end: '2026-10-17T19:30:00.000Z', travelClass: 'economy' });
  });

  it('reserves arrival formalities and boarding time for a same-airport connection', () => {
    const result = buildLoungeOpportunities(trip([domestic({ stayAfter: 'connection' }), onward()]));
    expect(result[1]).toMatchObject({ id: 'onward:transit', kind: 'transit', airport: 'LAX',
      start: '2026-10-17T19:00:00.000Z', end: '2026-10-17T22:15:00.000Z', minutes: 195 });
    expect(result[1].note).toContain('30 minutes for arrival formalities');
  });

  it('allows longer arrival formalities after an international incoming flight', () => {
    const inbound = leg({ stayAfter: 'connection' });
    const next = domestic({ id: 'next', departureAirport: 'HNL', arrivalAirport: 'SFO',
      departureDateTime: '2026-10-17T05:00', arrivalDateTime: '2026-10-17T13:00',
      departureTimeZone: 'Pacific/Honolulu', arrivalTimeZone: 'America/Los_Angeles' });
    const result = buildLoungeOpportunities(trip([inbound, next]));
    expect(result[1]).toMatchObject({ kind: 'transit', minutes: 180,
      start: '2026-10-17T11:30:00.000Z', end: '2026-10-17T14:30:00.000Z' });
    expect(result[1].note).toContain('60 minutes for arrival formalities');
  });

  it.each([
    ['too short', { departureDateTime: '2026-10-17T12:30' }],
    ['cross-airport', { departureAirport: 'SFO' }],
    ['long stopover', { departureDateTime: '2026-10-18T00:00', arrivalDateTime: '2026-10-19T09:00' }],
    ['overlapping flights', { departureDateTime: '2026-10-17T11:00' }],
  ])('does not invent a pre-flight fallback for a %s connection', (_label, changes) => {
    const result = buildLoungeOpportunities(trip([domestic({ stayAfter: 'connection' }), onward(changes)]));
    expect(result.map(value => value.legId)).toEqual(['outbound']);
  });

  it('requires at least a full hour of usable lounge time after the buffers', () => {
    const inbound = domestic({ stayAfter: 'connection' });
    const next = domestic({ id: 'next', departureAirport: 'LAX', arrivalAirport: 'SFO',
      departureDateTime: '2026-10-17T13:30', arrivalDateTime: '2026-10-17T15:00' });
    const result = buildLoungeOpportunities(trip([inbound, next]));
    expect(result[1]).toMatchObject({ kind: 'transit', minutes: 60 });
    expect(buildLoungeOpportunities(trip([inbound, { ...next, departureDateTime: '2026-10-17T13:29' }]))).toHaveLength(1);
  });

  it('gives destination stays an assumed pre-flight window and never starts it before arrival clearance', () => {
    const result = buildLoungeOpportunities(trip([domestic(), onward({ departureDateTime: '2026-10-17T14:00' })]));
    expect(result[1]).toMatchObject({ kind: 'pre-flight', start: '2026-10-17T19:00:00.000Z',
      end: '2026-10-17T20:15:00.000Z', minutes: 75 });
  });

  it('uses conservative international timing for an unknown country instead of inferring it from timezone', () => {
    const result = buildLoungeOpportunities(trip([domestic({ arrivalAirport: 'ZZZ' })]));
    expect(result[0]).toMatchObject({ minutes: 135, start: '2026-10-17T14:00:00.000Z', end: '2026-10-17T16:15:00.000Z' });
    expect(airportCountry(' zzz ')).toBeUndefined();
    expect(airportCountry(' mel ')).toBe('AU');
    expect(airportCountry('HNL')).toBe('US');
  });

  it('honors explicit DST folds using instants, including the repeated hour in a lounge visit', () => {
    const flight = domestic({ departureDateTime: '2026-11-01T01:30', arrivalDateTime: '2026-11-01T03:00', departureDisambiguation: 'later' });
    expect(buildLoungeOpportunities(trip([flight]))[0]).toMatchObject({
      start: '2026-11-01T07:30:00.000Z', end: '2026-11-01T09:00:00.000Z',
      departure: '2026-11-01T09:30:00.000Z', minutes: 90,
    });
    expect(buildLoungeOpportunities(trip([{ ...flight, departureDisambiguation: undefined }]))).toEqual([]);
  });

  it.each([
    { departureDateTime: '2026-03-08T02:30', arrivalDateTime: '2026-03-08T04:00' },
    { departureDateTime: 'not-a-date' },
    { departureTimeZone: 'Imaginary/Zone' },
    { arrivalDateTime: '2026-10-17T09:00' },
    { departureAirport: '' },
  ])('omits invalid flight timing or airport identifiers (%j)', changes => {
    expect(buildLoungeOpportunities(trip([domestic(changes)]))).toEqual([]);
  });

  it('does not use an invalid previous arrival to manufacture a later airport visit', () => {
    expect(buildLoungeOpportunities(trip([domestic({ arrivalDateTime: 'invalid' }), onward()]))).toEqual([]);
  });

  it('matches the real multi-destination itinerary without changing any trip data', () => {
    const itinerary = structuredClone(octoberItinerary.trip) as Trip;
    const before = structuredClone(itinerary);
    const result = buildLoungeOpportunities(itinerary);
    expect(result.map(value => [value.flightNumber, value.airport, value.kind])).toEqual([
      ['QF103', 'SYD', 'pre-flight'], ['AS812', 'HNL', 'pre-flight'], ['AA6276', 'SFO', 'pre-flight'],
      ['QF94', 'LAX', 'transit'], ['QF490', 'MEL', 'pre-flight'],
    ]);
    expect(result[3]).toMatchObject({ start: '2026-10-25T01:14:00.000Z', end: '2026-10-25T05:55:00.000Z', minutes: 281 });
    expect(itinerary).toEqual(before);
  });

  it('has no opportunities without flights', () => {
    expect(buildLoungeOpportunities(trip([]))).toEqual([]);
  });
});

describe('lounge links for every flight', () => {
  it('keeps all five real itinerary departures, including airports without lounge research', () => {
    const itinerary = structuredClone(octoberItinerary.trip) as Trip;
    const before = structuredClone(itinerary);
    const contexts = buildFlightLoungeContexts(itinerary);
    const opportunities = buildLoungeOpportunities(itinerary);
    expect(contexts.map(value => [value.flightNumber, value.airport, value.kind])).toEqual([
      ['QF103', 'SYD', 'pre-flight'], ['AS812', 'HNL', 'pre-flight'], ['AA6276', 'SFO', 'pre-flight'],
      ['QF94', 'LAX', 'transit'], ['QF490', 'MEL', 'pre-flight'],
    ]);
    expect(contexts).toEqual(opportunities.map(value => ({ ...value, windowStatus: 'estimated' })));
    expect(itinerary).toEqual(before);
  });

  it('provides a short LAX connection link using its real six minutes, without extending the visit', () => {
    const itinerary = trip([domestic({ stayAfter: 'connection' }), onward({
      departureDateTime: '2026-10-17T12:51', travelClass: 'first',
    })]);
    expect(buildLoungeOpportunities(itinerary)).toHaveLength(1);
    expect(buildFlightLoungeContexts(itinerary)[1]).toMatchObject({
      id: 'onward:transit', legId: 'onward', airport: 'LAX', kind: 'transit',
      flightNumber: 'QF94', destinationAirport: 'MEL', travelClass: 'first',
      departure: '2026-10-17T19:51:00.000Z', timeZone: 'America/Los_Angeles',
      start: '2026-10-17T19:00:00.000Z', end: '2026-10-17T19:06:00.000Z',
      minutes: 6, windowStatus: 'limited',
    });
  });

  it('also clamps a short destination stay to the actual arrival and clearance time', () => {
    const contexts = buildFlightLoungeContexts(trip([domestic(), onward({ departureDateTime: '2026-10-17T12:51' })]));
    expect(contexts[1]).toMatchObject({
      id: 'onward:pre-flight', kind: 'pre-flight', windowStatus: 'limited', minutes: 6,
      start: '2026-10-17T19:00:00.000Z', end: '2026-10-17T19:06:00.000Z',
    });
  });

  it.each(['connection', 'destination'] as const)('omits visit times when %s arrival and boarding allowances overlap', stayAfter => {
    const context = buildFlightLoungeContexts(trip([domestic({ stayAfter }), onward({ departureDateTime: '2026-10-17T12:30' })]))[1];
    expect(context).toMatchObject({ airport: 'LAX', windowStatus: 'unavailable',
      note: 'No usable lounge time remains after arrival and boarding allowances.' });
    expect(context).not.toHaveProperty('start');
    expect(context).not.toHaveProperty('end');
    expect(context).not.toHaveProperty('minutes');
  });

  it('treats an exact meeting of arrival and boarding buffers as unavailable', () => {
    const context = buildFlightLoungeContexts(trip([domestic({ stayAfter: 'connection' }), onward({ departureDateTime: '2026-10-17T12:45' })]))[1];
    expect(context.windowStatus).toBe('unavailable');
    expect(context).not.toHaveProperty('start');
  });

  it('uses the international incoming clearance allowance for a limited connection', () => {
    const next = domestic({ id: 'next', departureAirport: 'HNL', arrivalAirport: 'SFO',
      departureDateTime: '2026-10-17T02:10', arrivalDateTime: '2026-10-17T10:00',
      departureTimeZone: 'Pacific/Honolulu', arrivalTimeZone: 'America/Los_Angeles' });
    const context = buildFlightLoungeContexts(trip([leg({ stayAfter: 'connection' }), next]))[1];
    expect(context).toMatchObject({ airport: 'HNL', windowStatus: 'limited', minutes: 10,
      start: '2026-10-17T11:30:00.000Z', end: '2026-10-17T11:40:00.000Z' });
    expect(context.note).toContain('60 minutes for arrival formalities');
  });

  it.each([
    ['cross-airport transfer', domestic({ stayAfter: 'connection' }), onward({ departureAirport: 'SFO' }), 'transfer between airports'],
    ['long connection', domestic({ stayAfter: 'connection' }), onward({ departureDateTime: '2026-10-18T00:00', arrivalDateTime: '2026-10-19T09:00' }), 'longer than 12 hours'],
    ['invalid previous timing', domestic({ arrivalDateTime: 'invalid' }), onward(), 'timing is incomplete'],
    ['overlapping previous flight', domestic(), onward({ departureDateTime: '2026-10-17T11:00' }), 'overlaps this departure'],
  ] as const)('retains the departure link with an unknown visit for %s', (_label, inbound, next, reason) => {
    const context = buildFlightLoungeContexts(trip([inbound, next])).find(value => value.legId === 'onward');
    expect(context).toMatchObject({ legId: 'onward', windowStatus: 'unknown', flightNumber: 'QF94' });
    expect(context?.note).toContain('Set your airport arrival/visit time');
    expect(context?.note).toContain(reason);
    expect(context).not.toHaveProperty('start');
    expect(context).not.toHaveProperty('end');
    expect(context).not.toHaveProperty('minutes');
  });

  it('preserves a supplied repeated-hour choice as a real UTC departure and visit', () => {
    const flight = domestic({ departureDateTime: '2026-11-01T01:30', arrivalDateTime: '2026-11-01T03:00', departureDisambiguation: 'later' });
    expect(buildFlightLoungeContexts(trip([flight]))[0]).toMatchObject({
      windowStatus: 'estimated', start: '2026-11-01T07:30:00.000Z', end: '2026-11-01T09:00:00.000Z',
      departure: '2026-11-01T09:30:00.000Z', minutes: 90,
    });
    expect(buildFlightLoungeContexts(trip([{ ...flight, departureDisambiguation: undefined }]))).toEqual([]);
  });

  it.each([
    { departureDateTime: '2026-03-08T02:30', arrivalDateTime: '2026-03-08T04:00' },
    { departureDateTime: 'not-a-date' },
    { departureTimeZone: 'Imaginary/Zone' },
    { arrivalDateTime: '2026-10-17T09:00' },
    { departureAirport: '' },
  ])('does not expose a context for an invalid current flight (%j)', changes => {
    expect(buildFlightLoungeContexts(trip([domestic(changes)]))).toEqual([]);
  });

  it('has no departure links without flights', () => {
    expect(buildFlightLoungeContexts(trip([]))).toEqual([]);
  });
});
