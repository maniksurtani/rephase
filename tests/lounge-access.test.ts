import { describe, expect, it } from 'vitest';
import {
  airlineAlliance, evaluateAirportLounges, evaluateLounge, expandLoungeMemberships,
} from '../src/lib/lounge-access';
import lax from '../data/lounges/LAX.json';
import type { AirportLoungeData, Lounge, LoungeAccessRule, LoungeVisitContext } from '../src/lib/lounge-types';

const everyDay = [1, 2, 3, 4, 5, 6, 7];
const lounge = (change: Partial<Lounge> = {}): Lounge => ({
  id: 'sample', name: 'Sample lounge', terminal: 'T1', location: 'After security', airside: true, status: 'open',
  hours: { type: 'weekly', periods: [{ days: everyDay, open: '06:00', close: '22:00' }] },
  amenities: { showers: 'yes', dining: 'buffet', spa: 'no', quietArea: 'yes', wifi: 'yes' },
  accessRules: [{ id: 'pass', label: 'Priority Pass members', membershipsAnyOf: ['priority-pass'] }],
  sources: [{ id: 'official', title: 'Official access policy', url: 'https://example.org/policy', checkedOn: '2026-10-15' }],
  photos: [], ...change,
});
const data = (lounges: Lounge[] = [lounge()], change: Partial<AirportLoungeData> = {}): AirportLoungeData => ({
  schemaVersion: 1, airport: 'SFO', timeZone: 'America/Los_Angeles', updatedAt: '2026-10-15', lounges, ...change,
});
const context = (change: Partial<LoungeVisitContext> = {}): LoungeVisitContext => ({
  memberships: ['priority-pass'], terminal: 'T1', cabin: 'economy',
  visitStart: '2026-10-15T17:00:00Z', visitEnd: '2026-10-15T19:00:00Z', departure: '2026-10-15T20:00:00Z',
  operatingCarrier: 'QF', marketingCarrier: 'QF', route: 'international', destinationCountry: 'AU', now: '2026-10-15', ...change,
});
const check = (candidate = lounge(), visit = context(), airport = data()) => evaluateLounge(candidate, visit, airport);
const ruleLounge = (rule: LoungeAccessRule) => lounge({ accessRules: [rule] });

describe('lounge access matching', () => {
  it('expands Qantas status and alliance tiers without inventing paid memberships', () => {
    expect([...expandLoungeMemberships(['qantas-platinum-one'])]).toEqual(expect.arrayContaining(['qantas-platinum', 'qantas-gold', 'oneworld-emerald', 'oneworld-sapphire']));
    expect(expandLoungeMemberships(['qantas-gold']).has('oneworld-emerald')).toBe(false);
    expect(expandLoungeMemberships(['qantas-platinum']).has('qantas-club')).toBe(false);
  });

  it.each(['united-premier-gold', 'united-premier-platinum', 'united-premier-1k'] as const)('maps %s to alliance status without a paid club membership', membership => {
    const expanded = expandLoungeMemberships([membership]);
    expect(expanded.has('star-gold')).toBe(true);
    expect(expanded.has('united-club')).toBe(false);
    expect(expanded.has('qantas-gold')).toBe(false);
  });

  it('does not upgrade entry-level United membership or Premier Silver to Gold', () => {
    for (const membership of ['united-member', 'united-premier-silver'] as const) {
      expect(expandLoungeMemberships([membership]).has('star-gold')).toBe(false);
    }
    expect(expandLoungeMemberships(['united-premier-silver']).has('star-silver')).toBe(true);
    expect(expandLoungeMemberships(['united-club']).has('star-gold')).toBe(false);
  });

  it('identifies alliances for supplied carriers but leaves unverified carriers unknown', () => {
    expect(airlineAlliance(' qf ')).toBe('oneworld');
    expect(airlineAlliance('UA')).toBe('star');
    expect(airlineAlliance('VS')).toBe('skyteam');
    expect(airlineAlliance('HA')).toBe('oneworld');
    expect(airlineAlliance('ZZ')).toBeUndefined();
  });

  it('requires both marketed and operated oneworld flights for an alliance route', () => {
    const candidate = ruleLounge({ id: 'alliance', label: 'oneworld status', membershipsAnyOf: ['oneworld-sapphire'], marketingAlliance: 'oneworld', operatingAlliance: 'oneworld' });
    expect(check(candidate, context({ memberships: ['qantas-gold'] })).access).toBe('eligible');
    expect(check(candidate, context({ memberships: ['qantas-gold'], operatingCarrier: 'EK' })).access).toBe('ineligible');
    expect(check(candidate, context({ memberships: ['qantas-gold'], marketingCarrier: 'UA' })).access).toBe('ineligible');
  });

  it('does not infer the operator from the marketing flight number or alliance', () => {
    const candidate = ruleLounge({ id: 'business', label: 'oneworld business', cabinsAnyOf: ['business', 'first'], marketingAlliance: 'oneworld', operatingAlliance: 'oneworld' });
    const result = check(candidate, context({ cabin: 'business', operatingCarrier: undefined }));
    expect(result.access).toBe('conditional');
    expect(result.warnings.join(' ')).toContain('operating');
  });

  it('combines cabin, carrier, route and country restrictions with AND', () => {
    const candidate = ruleLounge({ id: 'business', label: 'Qantas business', cabinsAnyOf: ['business', 'first'], operatingCarriersAnyOf: ['QF'], route: 'international', destinationCountriesAnyOf: ['AU'], excludedDestinationCountries: ['US'] });
    expect(check(candidate, context({ cabin: 'business' })).access).toBe('eligible');
    for (const visit of [context({ cabin: 'economy' }), context({ cabin: 'business', operatingCarrier: 'AA' }), context({ cabin: 'business', route: 'domestic' }), context({ cabin: 'business', destinationCountry: 'US' })]) {
      expect(check(candidate, visit).access).toBe('ineligible');
    }
    expect(check(candidate, context({ cabin: 'business', destinationCountry: undefined })).access).toBe('conditional');
  });

  it('offers alternative access routes without requiring all memberships', () => {
    const candidate = lounge({ accessRules: [
      { id: 'status', label: 'Emerald status', membershipsAnyOf: ['oneworld-emerald'], operatingAlliance: 'oneworld' },
      { id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'] },
    ] });
    expect(check(candidate).access).toBe('eligible');
    expect(check(candidate).matchedRuleIds).toEqual(['pass']);
    expect(check(candidate).selectedRuleId).toBe('pass');
    expect(check(candidate, context({ memberships: [] })).access).toBe('ineligible');
  });

  it('keeps unencoded card, guest and domestic-status restrictions conditional', () => {
    const candidate = ruleLounge({ id: 'star', label: 'Star Gold', membershipsAnyOf: ['star-gold'], operatingAlliance: 'star', conditions: ['United-issued status requires an eligible international itinerary.'] });
    const result = check(candidate, context({ memberships: ['star-gold'], operatingCarrier: 'UA' }));
    expect(result.access).toBe('conditional');
    expect(result.warnings).toContain('United-issued status requires an eligible international itinerary.');
  });

  it('preserves charges and visit conditions in the explanation', () => {
    const candidate = ruleLounge({ id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'], note: 'An additional US$15 fee applies.', maxVisitMinutes: 120 });
    const result = check(candidate);
    expect(result.reasons).toContain('An additional US$15 fee applies.');
    expect(result.reasons.join(' ')).toContain('120 minutes');
  });

  it('checks terminal transfers and landside security without claiming them impossible', () => {
    expect(check(lounge(), context({ terminal: 'Terminal 1' })).access).toBe('eligible');
    expect(check(lounge(), context({ terminal: undefined })).access).toBe('conditional');
    expect(check(lounge(), context({ terminal: 'T2' })).access).toBe('conditional');
    expect(check(lounge({ airside: false })).access).toBe('conditional');
  });
});

describe('airport-local opening and visit windows', () => {
  it('clips a visit to opening hours rather than requiring the whole requested window to be open', () => {
    const result = check(lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '11:00', close: '12:00' }] } }));
    expect(result.opening).toBe('open');
    expect(result.visit).toEqual({ start: '2026-10-15T18:00:00.000Z', end: '2026-10-15T19:00:00.000Z', minutes: 60 });
  });

  it('uses the previous opening day for overnight hours after midnight', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: [4], open: '22:00', close: '02:00' }] } });
    const result = check(candidate, context({ visitStart: '2026-10-16T07:30:00Z', visitEnd: '2026-10-16T10:00:00Z' }));
    expect(result.visit?.minutes).toBe(90);
    expect(result.visit?.end).toBe('2026-10-16T09:00:00.000Z');
  });

  it('honors local-date closures, including spillover from the night before', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '22:00', close: '02:00' }], exceptions: [{ date: '2026-10-16', periods: [], note: 'Closed for maintenance' }] } });
    expect(check(candidate, context({ visitStart: '2026-10-16T07:30:00Z', visitEnd: '2026-10-16T09:00:00Z' })).opening).toBe('closed');
  });

  it('honors a date-specific replacement schedule', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '06:00', close: '22:00' }], exceptions: [{ date: '2026-10-15', periods: [{ open: '11:30', close: '12:30' }] }] } });
    expect(check(candidate).visit?.minutes).toBe(30);
  });

  it('merges overlapping opening periods instead of overstating usable time', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '09:00', close: '11:00' }, { days: everyDay, open: '10:30', close: '12:00' }] } });
    expect(check(candidate).visit?.minutes).toBe(120);
  });

  it('does not combine separate openings across a closure into a continuous visit', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '10:00', close: '10:20' }, { days: everyDay, open: '11:00', close: '11:20' }] } });
    const result = evaluateAirportLounges(data([candidate]), context());
    expect(result.results[0].visit?.minutes).toBe(20);
    expect(result.recommendedId).toBeNull();
  });

  it('treats equal opening and closing clocks as a full day and supports 24:00', () => {
    for (const close of ['00:00', '24:00']) {
      const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '00:00', close }] } });
      expect(check(candidate).visit?.minutes).toBe(120);
    }
  });

  it('measures the repeated autumn hour as elapsed time', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '00:00', close: '04:00' }] } });
    const result = check(candidate, context({ visitStart: '2026-11-01T07:00:00Z', visitEnd: '2026-11-01T12:00:00Z' }));
    expect(result.visit?.minutes).toBe(300);
  });

  it('measures a spring clock jump without inventing an extra hour', () => {
    const candidate = lounge({ hours: { type: 'weekly', periods: [{ days: everyDay, open: '22:00', close: '04:00' }] } });
    const result = check(candidate, context({ visitStart: '2026-03-08T06:00:00Z', visitEnd: '2026-03-08T11:00:00Z' }));
    expect(result.visit?.minutes).toBe(300);
  });

  it('restricts entry to 2½ hours before departure and caps the length of the visit', () => {
    const candidate = ruleLounge({ id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'], maxMinutesBeforeDeparture: 150, maxVisitMinutes: 60 });
    const result = check(candidate);
    expect(result.visit).toEqual({ start: '2026-10-15T17:30:00.000Z', end: '2026-10-15T18:30:00.000Z', minutes: 60 });
  });

  it('does not offer access when the usable visit is before the permitted entry window', () => {
    const candidate = ruleLounge({ id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'], maxMinutesBeforeDeparture: 30 });
    expect(check(candidate).access).toBe('ineligible');
    expect(evaluateAirportLounges(data([candidate]), context()).recommendedId).toBeNull();
  });

  it('uses a matching alternative route with a useful allowance', () => {
    const candidate = lounge({ accessRules: [
      { id: 'short', label: 'Brief visit', membershipsAnyOf: ['priority-pass'], maxVisitMinutes: 15 },
      { id: 'normal', label: 'Normal visit', membershipsAnyOf: ['priority-pass'], maxVisitMinutes: 60 },
    ] });
    const result = evaluateAirportLounges(data([candidate]), context());
    expect(result.recommendedId).toBe(candidate.id);
    expect(result.results[0].visit?.minutes).toBe(60);
    expect(result.results[0].reasons[0]).toBe('Normal visit');
    expect(result.results[0].selectedRuleId).toBe('normal');
  });

  it('keeps flight-dependent, missing and invalid hours unconfirmed', () => {
    for (const hours of [{ type: 'flight-dependent', note: 'Opens around departures.' }, { type: 'unknown' }, { type: 'weekly', periods: [{ days: everyDay, open: '25:00', close: '26:00' }] }] as Lounge['hours'][]) {
      const candidate = lounge({ hours });
      const result = evaluateAirportLounges(data([candidate]), context());
      expect(result.results[0].opening).toBe('unknown');
      expect(result.results[0].access).toBe('conditional');
      expect(result.recommendedId).toBeNull();
    }
  });

  it('reports a temporary closure even if normal weekly hours would be open', () => {
    const result = evaluateAirportLounges(data([lounge({ status: 'temporarily-closed' })]), context());
    expect(result.results[0].opening).toBe('closed');
    expect(result.recommendedId).toBeNull();
  });
});

describe('transparent, conservative lounge recommendations', () => {
  it('selects amenities according to the chosen priority among eligible, open lounges', () => {
    const shower = lounge({ id: 'shower', name: 'Shower lounge', amenities: { showers: 'yes', dining: 'snacks', spa: 'no', quietArea: 'yes', wifi: 'yes' } });
    const dining = lounge({ id: 'dining', name: 'Dining lounge', amenities: { showers: 'no', dining: 'restaurant', spa: 'no', quietArea: 'no', wifi: 'yes' } });
    expect(evaluateAirportLounges(data([dining, shower]), context({ priority: 'showers' })).recommendedId).toBe('shower');
    expect(evaluateAirportLounges(data([dining, shower]), context({ priority: 'dining' })).recommendedId).toBe('dining');
    const result = evaluateAirportLounges(data([dining, shower]), context({ priority: 'dining' }));
    const chosen = result.results.find(value => value.recommended)!;
    expect(chosen.reasons).toContain('Restaurant dining is listed, matching your priority.');
    expect(chosen.reasons).toContain('120 minutes are available within the opening and access windows.');
    expect(chosen.reasons.join(' ')).not.toMatch(/complimentary|free meal|free spa/i);
  });

  it('uses curated research as a modest preference boost among eligible open lounges', () => {
    const basic = lounge({ id: 'basic', name: 'A basic lounge' });
    const researched = lounge({ id: 'researched', name: 'Z researched lounge', recommendation: { summary: 'The shower area is beside a quieter seating section.', bestFor: ['showers'] } });
    const result = evaluateAirportLounges(data([basic, researched]), context({ priority: 'showers' }));
    expect(result.recommendedId).toBe('researched');
    expect(result.results.find(value => value.recommended)?.reasons).toContain('Research note: The shower area is beside a quieter seating section.');
    const unavailable = { ...researched, status: 'temporarily-closed' as const };
    expect(evaluateAirportLounges(data([basic, unavailable]), context({ priority: 'showers' })).recommendedId).toBe('basic');
  });

  it('reports only the selected route for fees even if other routes also match', () => {
    const candidate = lounge({ accessRules: [
      { id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'], maxVisitMinutes: 60, note: 'An additional US$15 fee applies.' },
      { id: 'qantas', label: 'Qantas Platinum', membershipsAnyOf: ['qantas-platinum'], operatingCarriersAnyOf: ['QF'] },
    ] });
    const result = check(candidate, context({ memberships: ['priority-pass', 'qantas-platinum'] }));
    expect(result.selectedRuleId).toBe('qantas');
    expect(result.matchedRuleIds).toEqual(expect.arrayContaining(['pass', 'qantas']));
    expect(result.reasons.join(' ')).not.toContain('US$15');
  });

  it('prefers a matching status route over an identical visit with a documented surcharge', () => {
    const candidate = lounge({ accessRules: [
      { id: 'pass', label: 'Priority Pass', membershipsAnyOf: ['priority-pass'], additionalFee: { amount: 15, currency: 'USD' }, note: 'An additional US$15 fee applies.' },
      { id: 'qantas', label: 'Qantas Platinum', membershipsAnyOf: ['qantas-platinum'], operatingCarriersAnyOf: ['QF'] },
    ] });
    const result = check(candidate, context({ memberships: ['priority-pass', 'qantas-platinum'] }));
    expect(result.selectedRuleId).toBe('qantas');
    expect(result.reasons.join(' ')).not.toContain('US$15');
    expect(result.reasons.join(' ')).not.toMatch(/free|complimentary/i);
  });

  it('compares documented surcharges in the same currency without currency conversion', () => {
    const candidate = lounge({ accessRules: [
      { id: 'expensive', label: 'Expensive pass', membershipsAnyOf: ['priority-pass'], additionalFee: { amount: 30, currency: 'USD' } },
      { id: 'cheaper', label: 'Cheaper pass', membershipsAnyOf: ['priority-pass'], additionalFee: { amount: 15, currency: 'USD' } },
    ] });
    expect(check(candidate).selectedRuleId).toBe('cheaper');
  });

  it('never recommends closed, conditional or ineligible lounges regardless of amenities', () => {
    const conditional = lounge({ id: 'conditional', accessRules: [{ id: 'pass', label: 'Pass', membershipsAnyOf: ['priority-pass'], conditions: ['Capacity restricted'] }] });
    const closed = lounge({ id: 'closed', status: 'temporarily-closed' });
    const ineligible = lounge({ id: 'ineligible', accessRules: [{ id: 'club', label: 'Club', membershipsAnyOf: ['united-club'] }] });
    const accessible = lounge({ id: 'accessible', amenities: { showers: 'no', dining: 'none', spa: 'no', quietArea: 'no', wifi: 'no' } });
    const result = evaluateAirportLounges(data([conditional, closed, ineligible, accessible]), context());
    expect(result.recommendedId).toBe('accessible');
    expect(result.results.filter(value => value.recommended).map(value => value.lounge.id)).toEqual(['accessible']);
  });

  it('marks stale, unsourced and missing-source data conditional', () => {
    expect(check(lounge(), context({ now: '2027-05-15' })).access).toBe('conditional');
    expect(check(lounge({ sources: [] })).access).toBe('conditional');
    expect(check(ruleLounge({ id: 'pass', label: 'Pass', membershipsAnyOf: ['priority-pass'], sourceIds: ['missing'] })).access).toBe('conditional');
  });

  it('does not penalize a rule for an unrelated stale source', () => {
    const candidate = lounge({
      accessRules: [{ id: 'pass', label: 'Pass', membershipsAnyOf: ['priority-pass'], sourceIds: ['official'] }],
      sources: [...lounge().sources, { id: 'old-photo', title: 'Historic picture', url: 'https://example.org/old-photo', checkedOn: '2020-01-01' }],
    });
    expect(check(candidate).access).toBe('eligible');
  });

  it('handles invalid visits without throwing or offering a recommendation', () => {
    for (const visit of [context({ visitStart: 'invalid' }), context({ visitEnd: '2026-10-15T16:00:00Z' })]) {
      const result = evaluateAirportLounges(data(), visit);
      expect(result.recommendedId).toBeNull();
      expect(result.results[0].access).toBe('ineligible');
    }
  });
});

describe('recognizable LAX lounges and United issuer-specific access', () => {
  const airport = lax as AirportLoungeData;
  const atLax = (change: Partial<LoungeVisitContext> = {}) => context({
    terminal: 'Tom Bradley International Terminal', now: '2026-10-16', ...change,
  });

  it('keeps the Qantas Business record recognizable, unique and accessible on Qantas', () => {
    const matches = airport.lounges.filter(value => value.id === 'lax-qantas-business');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Qantas / oneworld Business Lounge');
    const result = evaluateLounge(matches[0], atLax({ memberships: [], cabin: 'business' }), airport);
    expect(result.access).toBe('eligible');
    expect(result.opening).toBe('open');
    expect(result.lounge.amenities.showers).toBe('yes');
  });

  it('recognizes Premier 1K on an international Star departure without inventing opening hours', () => {
    const candidate = airport.lounges.find(value => value.id === 'lax-star-alliance')!;
    const visit = atLax({ memberships: ['united-premier-1k'], operatingCarrier: 'UA', marketingCarrier: 'UA', route: 'international' });
    const result = evaluateLounge(candidate, visit, airport);
    expect(result.access).toBe('conditional');
    expect(result.selectedRuleId).toBe('united-premier-gold-international');
    expect(result.matchedRuleIds).toContain('united-premier-gold-international');
    expect(result.opening).toBe('unknown');
    expect(result.recommended).toBe(false);
    expect(evaluateLounge(candidate, { ...visit, route: 'domestic' }, airport).access).toBe('conditional');
    expect(evaluateLounge(candidate, { ...visit, memberships: ['united-premier-silver'] }, airport).access).toBe('ineligible');
    expect(evaluateLounge(candidate, { ...visit, operatingCarrier: 'QF' }, airport).access).toBe('ineligible');
  });
});
