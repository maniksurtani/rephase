import { describe, expect, it } from 'vitest';
import { evaluateAirportLounges, evaluateLounge } from '../src/lib/lounge-access';
import { loungeDataFor } from '../src/lib/lounge-data';
import type { LoungeVisitContext } from '../src/lib/lounge-types';
import { airportCountry } from '../src/lib/lounge-windows';

const visit = (overrides: Partial<LoungeVisitContext> = {}): LoungeVisitContext => ({
  memberships: ['qantas-platinum'],
  cabin: 'economy',
  terminal: 'T1',
  operatingCarrier: 'QF',
  marketingCarrier: 'QF',
  route: 'international',
  destinationCountry: 'AU',
  visitStart: '2026-11-10T08:00:00Z',
  visitEnd: '2026-11-10T09:30:00Z',
  departure: '2026-11-10T10:00:00Z',
  now: '2026-11-17',
  ...overrides,
});

function check(airport: string, id: string, context = visit()) {
  const data = loungeDataFor(airport)!;
  return evaluateLounge(
    data.lounges.find((lounge) => lounge.id === id)!,
    context,
    data,
  );
}

describe('new airport lounge policies', () => {
  it('keeps Amsterdam border areas separate, including flights to another covered Schengen hub', () => {
    const schengen = visit({
      memberships: ['priority-pass'],
      terminal: 'Schengen departures',
      destinationCountry: airportCountry('MUC'),
    });
    expect(check('AMS', 'ams-aspire-26', schengen).access).toBe('conditional'); // M-gate check
    expect(check('AMS', 'ams-aspire-41', schengen).access).toBe('ineligible');
    const london = {
      ...schengen,
      terminal: 'Non-Schengen departures',
      destinationCountry: airportCountry('LHR'),
    };
    expect(check('AMS', 'ams-aspire-26', london).access).toBe('ineligible');
    expect(check('AMS', 'ams-aspire-41', london).access).toBe('conditional');
    // CDG -> AMS is also Schengen; T1 alone must not enable the non-Schengen lounge.
    expect(
      check(
        'CDG',
        'cdg-star-alliance-non-schengen',
        visit({
          memberships: ['star-gold'],
          operatingCarrier: 'UA',
          destinationCountry: airportCountry('AMS'),
        }),
      ).access,
    ).toBe('ineligible');
    const early = check('AMS', 'ams-aspire-26', {
      ...schengen,
      visitStart: '2026-11-10T05:00:00Z',
      visitEnd: '2026-11-10T06:30:00Z',
    });
    expect(early.visit).toBeUndefined(); // too early for the 10:00Z departure
  });

  it('routes Star Gold in Economy to Istanbul Miles&Smiles rather than Business', () => {
    const gold = visit({
      terminal: 'International departures',
      memberships: ['united-premier-1k'],
      operatingCarrier: 'TK',
      marketingCarrier: 'TK',
    });
    expect(check('IST', 'ist-turkish-miles-smiles', gold).access).toBe('eligible');
    expect(check('IST', 'ist-turkish-business', gold).access).toBe('ineligible');
    const premium = { ...gold, memberships: [], cabin: 'business' as const };
    expect(check('IST', 'ist-turkish-business', premium).access).toBe('eligible');
    expect(check('IST', 'ist-turkish-miles-smiles', premium).access).toBe('ineligible');
    expect(
      check('IST', 'ist-turkish-miles-smiles', {
        ...gold,
        route: 'domestic',
        destinationCountry: airportCountry('IST'),
      }).access,
    ).toBe('ineligible');
  });

  it('limits Dubai and Istanbul membership stays and does not grant Emirates Business Special automatically', () => {
    const pp = visit({ memberships: ['priority-pass'], visitEnd: '2026-11-10T12:00:00Z' });
    expect(
      check('DXB', 'dxb-plaza-premium-a', { ...pp, terminal: 'T3 Concourse A' }).visit?.minutes,
    ).toBe(120);
    const iga = check('IST', 'ist-iga-international', {
      ...pp,
      terminal: 'International departures',
    });
    expect(iga.access).toBe('conditional');
    expect(iga.visit?.minutes).toBe(120);
    const ek = visit({
      memberships: [],
      cabin: 'business',
      operatingCarrier: 'EK',
      marketingCarrier: 'EK',
      terminal: 'T3 Concourse B',
    });
    const business = check('DXB', 'dxb-emirates-business-b', ek);
    expect(business.access).toBe('conditional');
    expect(business.warnings.join(' ')).toContain('Business Special');
    expect(
      check('DXB', 'dxb-emirates-business-b', {
        ...ek,
        cabin: 'economy',
        memberships: ['emirates-blue'],
      }).access,
    ).toBe('ineligible');
  });

  it('uses Seoul local closing time and separates Matina from premium-cabin lounge access', () => {
    const context = visit({
      memberships: ['priority-pass'],
      terminal: 'T2',
      operatingCarrier: 'KE',
      marketingCarrier: 'KE',
      destinationCountry: 'US',
    });
    expect(check('ICN', 'icn-matina-t2', context).access).toBe('eligible');
    expect(
      check('ICN', 'icn-matina-t2', { ...context, memberships: [], cabin: 'business' }).access,
    ).toBe('ineligible');
    expect(
      check('ICN', 'icn-matina-t2', {
        ...context,
        visitStart: '2026-11-10T13:00:00Z',
        visitEnd: '2026-11-10T14:00:00Z',
        departure: '2026-11-10T15:00:00Z',
      }).opening,
    ).toBe('closed');
  });

  it('distinguishes Sydney domestic Club, Business and international Star Alliance access', () => {
    const domestic = visit({ terminal: 'T3', route: 'domestic', memberships: ['qantas-gold'] });
    expect(check('SYD', 'syd-qantas-club', domestic)).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
    expect(check('SYD', 'syd-qantas-domestic-business', domestic).access).toBe('ineligible');
    expect(
      check('SYD', 'syd-qantas-domestic-business', {
        ...domestic,
        memberships: ['qantas-platinum'],
      }).matchedRuleIds,
    ).toContain('qantas-premium-status');
    const star = visit({
      memberships: ['united-premier-1k'],
      operatingCarrier: 'NZ',
      marketingCarrier: 'NZ',
    });
    expect(check('SYD', 'syd-air-new-zealand', star).access).toBe('eligible');
    expect(
      check('SYD', 'syd-air-new-zealand', { ...star, memberships: ['priority-pass'] }).access,
    ).toBe('ineligible');
  });

  it('keeps Polaris fare confirmation and Marhaba refurbishment restrictions visible', () => {
    const united = visit({
      memberships: ['united-premier-1k'],
      terminal: 'International Terminal G',
      operatingCarrier: 'UA',
      marketingCarrier: 'UA',
    });
    expect(check('SFO', 'sfo-united-polaris', united).access).toBe('ineligible');
    expect(check('SFO', 'sfo-united-polaris', { ...united, cabin: 'business' }).access).toBe(
      'conditional',
    );
    expect(
      check('SFO', 'sfo-united-polaris', { ...united, cabin: 'first', route: 'domestic' }).access,
    ).toBe('ineligible');
    const marhaba = check(
      'SIN',
      'sin-marhaba-t3',
      visit({ terminal: 'T3', memberships: ['priority-pass'], visitEnd: '2026-11-10T12:00:00Z' }),
    );
    expect(marhaba.access).toBe('conditional');
    expect(marhaba.lounge.amenities.showers).toBe('no');
    expect(marhaba.visit?.minutes).toBeLessThanOrEqual(180);
  });

  it('separates Singapore First, paid Qantas Club and non-oneworld departures', () => {
    expect(check('SIN', 'sin-qantas-first').access).toBe('eligible');
    const member = visit({ memberships: ['qantas-club'] });
    expect(check('SIN', 'sin-qantas-first', member).access).toBe('ineligible');
    expect(check('SIN', 'sin-qantas-business', member).access).toBe('eligible');
    expect(check('SIN', 'sin-qantas-first', visit({ operatingCarrier: 'SQ' })).access).toBe(
      'ineligible',
    );
  });

  it('honors Singapore weekday closures and the previous evening opening after midnight', () => {
    const at = (start: string, end: string) => visit({ visitStart: start, visitEnd: end });
    // Tuesday 11:00–12:00 SGT is between its morning and afternoon sessions.
    expect(
      check('SIN', 'sin-qantas-business', at('2026-11-10T03:00:00Z', '2026-11-10T04:00:00Z'))
        .opening,
    ).toBe('closed');
    expect(
      check('SIN', 'sin-qantas-business', at('2026-11-10T06:30:00Z', '2026-11-10T07:00:00Z'))
        .opening,
    ).toBe('open');
    expect(
      check('SIN', 'sin-qantas-business', at('2026-11-09T16:15:00Z', '2026-11-09T16:45:00Z'))
        .opening,
    ).toBe('open');
  });

  it('sends United 1K in Economy to KrisFlyer Gold, and excludes Scoot', () => {
    const gold = visit({
      memberships: ['united-premier-1k'],
      terminal: 'T3',
      operatingCarrier: 'SQ',
      marketingCarrier: 'SQ',
    });
    expect(check('SIN', 'sin-krisflyer-gold-t3', gold).access).toBe('eligible');
    expect(check('SIN', 'sin-silverkris-business-t3', gold).access).toBe('ineligible');
    expect(check('SIN', 'sin-silverkris-business-t3', { ...gold, cabin: 'business' }).access).toBe(
      'eligible',
    );
    expect(
      check('SIN', 'sin-krisflyer-gold-t3', {
        ...gold,
        operatingCarrier: 'TR',
        marketingCarrier: 'TR',
      }).access,
    ).toBe('ineligible');
    const pp = check(
      'SIN',
      'sin-plaza-premium-t1',
      visit({ memberships: ['priority-pass'], visitEnd: '2026-11-10T11:00:00Z' }),
    );
    expect(pp.visit?.minutes).toBe(120);
  });

  it('keeps Cairns flight-dependent hours uncertain and domestic access out of T1', () => {
    const domestic = visit({ terminal: 'T2', route: 'domestic', destinationCountry: 'AU' });
    expect(check('CNS', 'cns-qantas-club', domestic)).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
    expect(evaluateAirportLounges(loungeDataFor('CNS')!, domestic).recommendedId).toBeNull();
    expect(check('CNS', 'cns-qantas-club', { ...domestic, terminal: 'T1' }).access).toBe(
      'conditional',
    );
    expect(
      check('CNS', 'cns-qantas-club', { ...domestic, memberships: ['priority-pass'] }).access,
    ).toBe('ineligible');
  });

  it('does not turn Delta domestic First or Medallion status into unrestricted Sky Club access', () => {
    const domestic = visit({
      memberships: [],
      terminal: 'Concourse A',
      route: 'domestic',
      destinationCountry: 'US',
      operatingCarrier: 'DL',
      marketingCarrier: 'DL',
      cabin: 'first',
    });
    expect(check('SLC', 'slc-delta-sky-club-a', domestic).access).toBe('ineligible');
    expect(
      check('SLC', 'slc-delta-sky-club-a', { ...domestic, memberships: ['delta-gold-medallion'] })
        .access,
    ).toBe('ineligible');
    expect(
      check('SLC', 'slc-delta-sky-club-a', { ...domestic, memberships: ['amex-platinum'] }).access,
    ).toBe('conditional');
    const amex = visit({
      ...domestic,
      memberships: ['amex-platinum'],
      terminal: 'Concourse B',
      visitStart: '2026-11-10T16:00:00Z',
      visitEnd: '2026-11-10T18:00:00Z',
      departure: '2026-11-10T19:00:00Z',
    });
    expect(check('SLC', 'slc-centurion', amex)).toMatchObject({
      access: 'eligible',
      opening: 'open',
    });
    expect(
      check('SLC', 'slc-centurion', {
        ...amex,
        memberships: ['delta-skymiles-reserve'],
        operatingCarrier: 'UA',
        marketingCarrier: 'UA',
      }).access,
    ).toBe('ineligible');
    expect(
      check('SLC', 'slc-centurion', {
        ...amex,
        visitStart: '2026-11-10T14:00:00Z',
        visitEnd: '2026-11-10T15:00:00Z',
      }).access,
    ).toBe('ineligible');
  });

  it('keeps Heathrow terminal transfers conditional and honors Sunday Qantas opening', () => {
    const sunday = visit({
      terminal: 'T3',
      visitStart: '2026-11-08T06:30:00Z',
      visitEnd: '2026-11-08T07:30:00Z',
      departure: '2026-11-08T10:00:00Z',
    });
    expect(check('LHR', 'lhr-qantas', sunday).opening).toBe('closed');
    const afterOpening = {
      ...sunday,
      visitStart: '2026-11-08T08:00:00Z',
      visitEnd: '2026-11-08T09:00:00Z',
    };
    expect(check('LHR', 'lhr-qantas', afterOpening)).toMatchObject({
      access: 'eligible',
      opening: 'open',
    });
    expect(check('LHR', 'lhr-qantas', { ...afterOpening, terminal: 'T5' }).access).toBe(
      'conditional',
    );
    expect(
      check('LHR', 'lhr-plaza-premium-t5', {
        ...afterOpening,
        terminal: 'T5',
        memberships: ['priority-pass'],
      }).access,
    ).toBe('eligible');
  });

  it('matches Munich departure areas and distinguishes Lufthansa Business from Senator access', () => {
    const europe = visit({
      memberships: ['priority-pass'],
      destinationCountry: 'FR',
      visitStart: '2026-11-10T08:00:00Z',
      visitEnd: '2026-11-10T09:00:00Z',
    });
    expect(check('MUC', 'muc-airport-lounge-europe', europe).access).toBe('eligible');
    expect(check('MUC', 'muc-airport-lounge-world', europe).access).toBe('ineligible');
    const world = { ...europe, destinationCountry: 'GB' };
    expect(check('MUC', 'muc-airport-lounge-world', world).access).toBe('eligible');
    expect(check('MUC', 'muc-airport-lounge-europe', world).access).toBe('ineligible');
    const lh = {
      ...world,
      memberships: [] as LoungeVisitContext['memberships'],
      terminal: 'T2',
      operatingCarrier: 'LH',
      marketingCarrier: 'LH',
      cabin: 'business' as const,
    };
    expect(check('MUC', 'muc-lufthansa-business-h24', lh).access).toBe('eligible');
    expect(check('MUC', 'muc-lufthansa-senator-h24', lh).access).toBe('ineligible');
    expect(
      check('MUC', 'muc-lufthansa-senator-h24', {
        ...lh,
        cabin: 'economy',
        memberships: ['united-premier-1k'],
      }).access,
    ).toBe('eligible');
    expect(
      check('MUC', 'muc-lufthansa-business-h24', {
        ...lh,
        cabin: 'economy',
        memberships: ['amex-platinum'],
      }).access,
    ).toBe('ineligible');
  });
});
