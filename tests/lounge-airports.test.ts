import { describe, expect, it } from 'vitest';
import { evaluateAirportLounges, evaluateLounge } from '../src/lib/lounge-access';
import { loungeDataFor } from '../src/lib/lounge-data';
import type { LoungeVisitContext } from '../src/lib/lounge-types';

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
  now: '2026-11-08',
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
