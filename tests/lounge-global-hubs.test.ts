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
    now: '2026-11-20',
    ...overrides,
  };
  return evaluateLounge(lounge, visit, data);
}

describe('global hub access exceptions', () => {
  it('keeps Daxing domestic and international access separate without importing SkyTeam rights', () => {
    const premium: Partial<LoungeVisitContext> = {
      operatingCarrier: 'CZ',
      marketingCarrier: 'CZ',
      cabin: 'business',
      route: 'domestic',
    };
    expect(check('PKX', 'pkx-china-southern-domestic-1', premium).access).toBe('conditional');
    expect(check('PKX', 'pkx-china-southern-international', premium).access).toBe('ineligible');
    expect(
      check('PKX', 'pkx-china-southern-domestic-1', {
        ...premium,
        cabin: 'economy',
        memberships: ['skyteam-elite-plus'],
      }).access,
    ).toBe('ineligible');
    const pp: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      visitStart: '2026-11-20T23:00:00+08:00',
      visitEnd: '2026-11-21T03:00:00+08:00',
      departure: '2026-11-21T05:00:00+08:00',
    };
    expect(check('PKX', 'pkx-east-pacific-international', pp)).toMatchObject({
      access: 'eligible',
      opening: 'open',
      visit: { minutes: 180 },
    });
    expect(check('PKX', 'pkx-chum-domestic', pp).access).toBe('ineligible');
  });

  it('recognises Shenzhen Airlines as Star while retaining domestic lounge carrier limits', () => {
    const gold: Partial<LoungeVisitContext> = {
      operatingCarrier: 'ZH',
      marketingCarrier: 'ZH',
      memberships: ['united-premier-1k'],
    };
    expect(check('SZX', 'szx-shenzhen-king-international', gold).access).toBe('conditional');
    expect(check('SZX', 'szx-shenzhen-king-hall-3', gold).access).toBe('ineligible');
    expect(check('SZX', 'szx-shenzhen-king-hall-3', { ...gold, route: 'domestic' }).access).toBe(
      'conditional',
    );
    expect(
      check('SZX', 'szx-shenzhen-king-international', {
        ...gold,
        operatingCarrier: 'CZ',
        marketingCarrier: 'CZ',
      }).access,
    ).toBe('ineligible');
  });

  it('restricts Tianfu V2 Priority Pass access to the listed domestic operating airlines', () => {
    const pp: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      route: 'domestic',
      marketingCarrier: 'MU',
      visitStart: '2026-11-20T10:00:00+08:00',
      visitEnd: '2026-11-20T13:00:00+08:00',
      departure: '2026-11-20T15:00:00+08:00',
    };
    for (const operatingCarrier of ['MU', 'FM', 'KN']) {
      expect(check('TFU', 'tfu-china-eastern-v2', { ...pp, operatingCarrier })).toMatchObject({
        access: 'conditional',
        visit: { minutes: 120 },
      });
    }
    expect(check('TFU', 'tfu-china-eastern-v2', { ...pp, operatingCarrier: 'CA' }).access).toBe(
      'ineligible',
    );
    expect(
      check('TFU', 'tfu-china-eastern-v2', {
        ...pp,
        operatingCarrier: 'MU',
        route: 'international',
      }).access,
    ).toBe('ineligible');
  });

  it('does not promote Star Gold to separate First or premium sections at Tianfu and Honolulu', () => {
    const gold: Partial<LoungeVisitContext> = {
      memberships: ['star-gold'],
      operatingCarrier: 'CA',
      marketingCarrier: 'CA',
      route: 'domestic',
    };
    expect(check('TFU', 'tfu-air-china-4f', gold).access).toBe('conditional');
    expect(check('TFU', 'tfu-air-china-2f', gold).access).toBe('ineligible');
    const ana = {
      ...gold,
      operatingCarrier: 'NH',
      marketingCarrier: 'NH',
      route: 'international' as const,
    };
    expect(check('HNL', 'hnl-ana-lounge', ana).access).toBe('conditional');
    expect(check('HNL', 'hnl-ana-suite', ana).access).toBe('ineligible');
    expect(check('HNL', 'hnl-ana-suite', { ...ana, cabin: 'first' }).access).toBe('conditional');
  });

  it('allows United Gold in SFO Maple Leaf on domestic United within the normal entry window', () => {
    const gold: Partial<LoungeVisitContext> = {
      memberships: ['united-premier-gold'],
      operatingCarrier: 'UA',
      marketingCarrier: 'UA',
      route: 'domestic',
      destinationCountry: 'US',
      visitStart: '2026-11-20T10:00:00-08:00',
      visitEnd: '2026-11-20T11:00:00-08:00',
      departure: '2026-11-20T12:00:00-08:00',
    };
    expect(check('SFO', 'sfo-maple-leaf', gold).access).toBe('eligible');
    expect(check('SFO', 'sfo-united-polaris', gold).access).toBe('ineligible');
  });

  it('applies Charlotte’s 150-minute Priority Pass limit and Detroit’s split admission hours', () => {
    const pp: Partial<LoungeVisitContext> = {
      memberships: ['priority-pass'],
      visitStart: '2026-11-19T14:00:00Z',
      visitEnd: '2026-11-19T17:00:00Z',
      departure: '2026-11-19T17:00:00Z',
    };
    expect(check('CLT', 'clt-the-club-a', pp).visit?.minutes).toBe(150);
    expect(check('DTW', 'dtw-lufthansa-business', pp).opening).toBe('open');
    expect(
      check('DTW', 'dtw-lufthansa-business', {
        ...pp,
        visitStart: '2026-11-19T18:00:00Z',
        visitEnd: '2026-11-19T19:00:00Z',
        departure: '2026-11-19T21:00:00Z',
      }).opening,
    ).toBe('closed');
    expect(
      check('DTW', 'dtw-lufthansa-business', {
        ...pp,
        visitStart: '2026-11-22T14:00:00Z',
        visitEnd: '2026-11-22T15:00:00Z',
        departure: '2026-11-22T17:00:00Z',
      }).opening,
    ).toBe('closed');
  });

  it('does not extend temporary Brussels Business access or Warsaw Frequent Traveller to every Star carrier', () => {
    const business: Partial<LoungeVisitContext> = {
      cabin: 'business',
      destinationCountry: 'DE',
      operatingCarrier: 'SN',
      marketingCarrier: 'SN',
    };
    expect(check('BRU', 'bru-pop-up-loft', business).access).toBe('conditional');
    expect(
      check('BRU', 'bru-pop-up-loft', {
        ...business,
        operatingCarrier: 'TP',
        marketingCarrier: 'TP',
      }).access,
    ).toBe('ineligible');
    const frequent: Partial<LoungeVisitContext> = {
      memberships: ['miles-and-more-frequent-traveller'],
      destinationCountry: 'DE',
      operatingCarrier: 'LO',
      marketingCarrier: 'LO',
    };
    expect(check('WAW', 'waw-lot-polonez', frequent).access).toBe('conditional');
    expect(
      check('WAW', 'waw-lot-polonez', {
        ...frequent,
        operatingCarrier: 'TK',
        marketingCarrier: 'TK',
      }).access,
    ).toBe('ineligible');
    expect(check('WAW', 'waw-lot-mazurek', frequent).access).toBe('ineligible');
  });

  it('keeps Bahrain’s closed flagship separate from its airline-invitation replacement', () => {
    const premium: Partial<LoungeVisitContext> = {
      cabin: 'business',
      operatingCarrier: 'GF',
      marketingCarrier: 'GF',
    };
    expect(check('BAH', 'bah-falcon-gold', premium).opening).toBe('closed');
    expect(check('BAH', 'bah-pearl-departures', premium)).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
    expect(
      check('BAH', 'bah-pearl-departures', {
        ...premium,
        cabin: 'economy',
        memberships: ['priority-pass'],
      }).access,
    ).toBe('ineligible');
  });

  it('distinguishes Brussels’ temporary Star Gold access from The View’s carrier restriction', () => {
    const gold: Partial<LoungeVisitContext> = {
      memberships: ['united-premier-1k'],
      operatingCarrier: 'TK',
      marketingCarrier: 'TK',
      destinationCountry: 'DE',
    };
    expect(check('BRU', 'bru-pop-up-loft', gold).access).toBe('eligible');
    expect(check('BRU', 'bru-the-view', { ...gold, destinationCountry: 'US' }).access).toBe(
      'ineligible',
    );
    expect(
      check('BRU', 'bru-the-view', {
        ...gold,
        destinationCountry: 'US',
        operatingCarrier: 'SN',
        marketingCarrier: 'SN',
      }).access,
    ).toBe('eligible');
  });

  it('keeps Kansai’s ANA and JAL replacement lounge entitlements separate', () => {
    const ana: Partial<LoungeVisitContext> = {
      memberships: ['united-premier-1k'],
      operatingCarrier: 'NH',
      marketingCarrier: 'NH',
    };
    expect(check('KIX', 'kix-lounge-kansai', ana)).toMatchObject({
      access: 'conditional',
      opening: 'unknown',
    });
    expect(check('KIX', 'kix-lounge-premium', ana).access).toBe('ineligible');
    const jal: Partial<LoungeVisitContext> = {
      cabin: 'business',
      operatingCarrier: 'JL',
      marketingCarrier: 'JL',
    };
    expect(check('KIX', 'kix-lounge-premium', jal).access).toBe('eligible');
    expect(check('KIX', 'kix-lounge-kansai', jal).access).toBe('ineligible');
  });

  it('respects both ends of Lima’s overnight domestic lounge maintenance closure', () => {
    const pp: Partial<LoungeVisitContext> = { memberships: ['priority-pass'], route: 'domestic' };
    for (const [start, end, departure, opening] of [
      [
        '2026-11-30T09:00:00-05:00',
        '2026-11-30T10:00:00-05:00',
        '2026-11-30T11:00:00-05:00',
        'open',
      ],
      [
        '2026-11-30T12:00:00-05:00',
        '2026-11-30T13:00:00-05:00',
        '2026-11-30T14:00:00-05:00',
        'closed',
      ],
      [
        '2026-12-01T02:00:00-05:00',
        '2026-12-01T03:00:00-05:00',
        '2026-12-01T04:00:00-05:00',
        'closed',
      ],
      [
        '2026-12-01T04:00:00-05:00',
        '2026-12-01T05:00:00-05:00',
        '2026-12-01T06:00:00-05:00',
        'open',
      ],
    ]) {
      expect(
        check('LIM', 'lim-club-domestic', {
          ...pp,
          visitStart: start,
          visitEnd: end,
          departure,
        }).opening,
        start,
      ).toBe(opening);
    }
  });

  it('requires Delta marketing for the San Juan Escape Reserve benefit', () => {
    const reserve: Partial<LoungeVisitContext> = {
      memberships: ['delta-skymiles-reserve'],
      operatingCarrier: 'DL',
      marketingCarrier: 'AF',
    };
    expect(check('SJU', 'sju-escape-b', reserve).access).toBe('ineligible');
    expect(
      check('SJU', 'sju-escape-b', {
        ...reserve,
        operatingCarrier: 'AF',
        marketingCarrier: 'DL',
      }).access,
    ).toBe('conditional');
  });

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
