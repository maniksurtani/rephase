import { describe, expect, it } from 'vitest';
import { evaluateLounge } from '../src/lib/lounge-access';
import type { LoungeVisitContext } from '../src/lib/lounge-types';
import { loungeDataFor } from './support/lounge-data';

function check(airport: string, id: string, overrides: Partial<LoungeVisitContext> = {}) {
  const data = loungeDataFor(airport)!;
  const lounge = data.lounges.find((value) => value.id === id)!;
  const visit: LoungeVisitContext = {
    memberships: [],
    cabin: 'economy',
    operatingCarrier: 'QR',
    marketingCarrier: 'QR',
    route: 'international',
    terminal: lounge.terminal,
    destinationCountry: 'AU',
    visitStart: '2026-11-19T09:00:00Z',
    visitEnd: '2026-11-19T10:00:00Z',
    departure: '2026-11-19T12:00:00Z',
    now: '2026-11-18',
    ...overrides,
  };
  return evaluateLounge(lounge, visit, data);
}

describe('global hub access exceptions', () => {
  it('sends oneworld status in Economy to Qatar Gold rather than Al Mourjan', () => {
    const status = { memberships: ['qantas-platinum'] as const };
    expect(
      check('DOH', 'doh-al-mourjan-garden', { memberships: [...status.memberships] }).access,
    ).toBe('ineligible');
    expect(
      check('DOH', 'doh-qatar-gold-south', { memberships: [...status.memberships] }),
    ).toMatchObject({ access: 'conditional', opening: 'unknown' });
    expect(check('DOH', 'doh-al-mourjan-garden', { cabin: 'business' }).access).toBe('conditional');
    expect(check('DOH', 'doh-al-mourjan-garden', { cabin: 'first' })).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
  });

  it('limits TIAT Priority Pass visits to the verified overnight access window', () => {
    const visit: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      operatingCarrier: 'NH',
      marketingCarrier: 'NH',
      visitStart: '2026-11-19T02:00:00+09:00',
      visitEnd: '2026-11-19T04:00:00+09:00',
      departure: '2026-11-19T06:00:00+09:00',
    };
    expect(check('HND', 'hnd-tiat-t3', visit).opening).toBe('open');
    expect(
      check('HND', 'hnd-tiat-t3', {
        ...visit,
        visitStart: '2026-11-19T09:00:00+09:00',
        visitEnd: '2026-11-19T10:00:00+09:00',
        departure: '2026-11-19T12:00:00+09:00',
      }).opening,
    ).toBe('closed');
  });

  it('recognises current ITA Star eligibility and keeps Rome border zones separate', () => {
    const visit: Partial<LoungeVisitContext> = {
      memberships: ['star-gold'],
      operatingCarrier: 'AZ',
      marketingCarrier: 'AZ',
      destinationCountry: 'ES',
    };
    expect(check('FCO', 'fco-ita-hangar', visit).access).toBe('eligible');
    expect(check('FCO', 'fco-ita-piazza-di-spagna', visit).access).toBe('ineligible');
    expect(
      check('FCO', 'fco-ita-piazza-di-spagna', { ...visit, destinationCountry: 'US' }).access,
    ).toBe('eligible');
    expect(
      check('FCO', 'fco-ita-hangar', { ...visit, operatingCarrier: 'SK', marketingCarrier: 'SK' })
        .access,
    ).toBe('ineligible');
  });

  it('respects both sides of Taipei maintenance and flags restricted amenities', () => {
    const visit: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      visitStart: '2026-11-18T23:30:00+08:00',
      visitEnd: '2026-11-19T00:30:00+08:00',
      departure: '2026-11-19T02:00:00+08:00',
    };
    expect(check('TPE', 'tpe-oriental-club-t2', visit).opening).toBe('closed');
    const reopened = check('TPE', 'tpe-oriental-club-t2', {
      ...visit,
      visitStart: '2026-11-19T05:00:00+08:00',
      visitEnd: '2026-11-19T06:00:00+08:00',
      departure: '2026-11-19T08:00:00+08:00',
    });
    expect(reopened.opening).toBe('open');
    expect(reopened.access).toBe('conditional');
    expect(reopened.warnings.join(' ')).toMatch(/shower|amenit/i);
  });

  it('does not generalise Delhi Maharaja access to other Star Alliance departures', () => {
    const status: Partial<LoungeVisitContext> = {
      memberships: ['star-gold'],
      operatingCarrier: 'AI',
      marketingCarrier: 'AI',
    };
    expect(check('DEL', 'del-air-india-maharaja-business', status)).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
    expect(
      check('DEL', 'del-air-india-maharaja-business', {
        ...status,
        operatingCarrier: 'LH',
        marketingCarrier: 'LH',
      }).access,
    ).toBe('ineligible');
  });

  it('uses researched LATAM partner rules instead of legacy oneworld access', () => {
    const flight: Partial<LoungeVisitContext> = { operatingCarrier: 'LA', marketingCarrier: 'LA' };
    expect(
      check('GRU', 'gru-latam-international', { ...flight, memberships: ['qantas-platinum'] })
        .access,
    ).toBe('ineligible');
    expect(
      check('GRU', 'gru-latam-international', { ...flight, memberships: ['delta-gold-medallion'] })
        .access,
    ).toBe('eligible');
    expect(
      check('SCL', 'scl-latam-signature', { ...flight, memberships: ['delta-gold-medallion'] })
        .access,
    ).toBe('ineligible');
    expect(
      check('SCL', 'scl-latam-signature', { ...flight, memberships: ['delta-platinum-medallion'] }),
    ).toMatchObject({ access: 'conditional', opening: 'unknown' });
  });

  it('requires a SkyTeam operating or marketing carrier even with Priority Pass at Santiago', () => {
    const visit: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      operatingCarrier: 'LA',
      marketingCarrier: 'LA',
    };
    expect(check('SCL', 'scl-skyteam-international', visit).access).toBe('ineligible');
    expect(
      check('SCL', 'scl-skyteam-international', { ...visit, marketingCarrier: 'DL' }).access,
    ).toBe('eligible');
    expect(
      check('SCL', 'scl-skyteam-international', { ...visit, operatingCarrier: 'AF' }).access,
    ).toBe('eligible');
  });

  it('does not extend the Sky Club partner premium route to ordinary Delta First', () => {
    expect(
      check('ATL', 'atl-delta-sky-club-f', {
        operatingCarrier: 'DL',
        marketingCarrier: 'DL',
        cabin: 'first',
      }).access,
    ).toBe('ineligible');
    const partner = check('ATL', 'atl-delta-sky-club-f', {
      operatingCarrier: 'AF',
      marketingCarrier: 'AF',
      cabin: 'business',
    });
    expect(partner.access).toBe('conditional');
    expect(partner.warnings.join(' ')).toMatch(/every|all.*segment/i);
  });
});
