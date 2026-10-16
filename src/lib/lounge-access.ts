import { Temporal } from '@js-temporal/polyfill';
import { LOYALTY_PROGRAMS } from './lounge-programs';
import type {
  AirportLoungeData, Lounge, LoungeAccessRule, LoungeAlliance, LoungeEvaluation,
  LoungeMembership, LoungeRecommendations, LoungeVisitContext,
} from './lounge-types';

const MINUTE = 60_000;
const REVIEW_DAYS = 180;
type Interval = { start: number; end: number };
type RuleResult = { rule: LoungeAccessRule; access: LoungeEvaluation['access']; reasons: string[]; warnings: string[]; window: Interval };

/** Status includes the published alliance tier, without assuming a card issuer or guest allowance. */
export function expandLoungeMemberships(memberships: readonly LoungeMembership[]): Set<LoungeMembership> {
  const result = new Set(memberships);
  for (const program of LOYALTY_PROGRAMS) {
    for (const tier of program.tiers) {
      if (result.has(tier.id) && tier.allianceTier) result.add(tier.allianceTier);
    }
  }
  if (result.has('qantas-platinum-one')) result.add('qantas-platinum');
  if (result.has('qantas-platinum')) { result.add('qantas-gold'); result.add('oneworld-emerald'); }
  if (result.has('qantas-gold') || result.has('oneworld-emerald')) result.add('oneworld-sapphire');
  return result;
}

// Codes identify the carrier supplied in the context, never the operator of a codeshare.
const ALLIANCES: Record<string, LoungeAlliance> = {
  AA: 'oneworld', AS: 'oneworld', AT: 'oneworld', AY: 'oneworld', BA: 'oneworld', CX: 'oneworld',
  FJ: 'oneworld', HA: 'oneworld', IB: 'oneworld', JL: 'oneworld', MH: 'oneworld', QF: 'oneworld', QR: 'oneworld',
  RJ: 'oneworld', UL: 'oneworld', WY: 'oneworld',
  A3: 'star', AC: 'star', AI: 'star', AV: 'star', BR: 'star', CA: 'star', CM: 'star', ET: 'star',
  LH: 'star', LO: 'star', LX: 'star', MS: 'star', NH: 'star', NZ: 'star', OS: 'star', OU: 'star',
  SA: 'star', SK: 'skyteam', SN: 'star', SQ: 'star', TG: 'star', TK: 'star', TP: 'star', UA: 'star',
  AF: 'skyteam', AM: 'skyteam', AR: 'skyteam', CI: 'skyteam', DL: 'skyteam', GA: 'skyteam',
  KE: 'skyteam', KL: 'skyteam', KQ: 'skyteam', ME: 'skyteam', MU: 'skyteam', RO: 'skyteam',
  SV: 'skyteam', VN: 'skyteam', VS: 'skyteam', UX: 'skyteam',
};
const NON_ALLIANCE_CARRIERS = new Set(['B6', 'EK', 'F9', 'G4', 'JQ', 'NK', 'VA', 'WN']);

export function loungeCarrierAlliance(carrier?: string): LoungeAlliance | undefined {
  return carrier ? ALLIANCES[carrier.trim().toUpperCase()] : undefined;
}
export const airlineAlliance = loungeCarrierAlliance;

function epoch(instant: string): number { return Temporal.Instant.from(instant).epochMilliseconds; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function intersection(a: Interval, b: Interval): Interval | undefined {
  const value = { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
  return value.end > value.start ? value : undefined;
}
function mergeIntervals(values: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const value of values.sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && value.start <= previous.end) previous.end = Math.max(previous.end, value.end);
    else result.push({ ...value });
  }
  return result;
}

function wallInstant(date: Temporal.PlainDate, time: string, zone: string): number {
  if (time === '24:00') return date.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds;
  if (!/^\d{2}:\d{2}$/.test(time)) throw new RangeError('Invalid opening clock');
  const clock = Temporal.PlainTime.from(time, { overflow: 'reject' });
  return date.toPlainDateTime(clock).toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds;
}

/** Local recurring hours are expanded into real UTC intervals, including overnight and DST days. */
function openingIntervals(lounge: Lounge, data: AirportLoungeData, requested: Interval): Interval[] | undefined {
  if (lounge.hours.type !== 'weekly' || !lounge.hours.periods) return undefined;
  try {
    let date = Temporal.Instant.fromEpochMilliseconds(requested.start).toZonedDateTimeISO(data.timeZone).toPlainDate();
    const lastDate = Temporal.Instant.fromEpochMilliseconds(requested.end - 1).toZonedDateTimeISO(data.timeZone).toPlainDate();
    const result: Interval[] = [];
    const periodsFor = (day: Temporal.PlainDate) => {
      const exception = lounge.hours.exceptions?.find(value => value.date === day.toString());
      return exception?.periods ?? lounge.hours.periods!.filter(period => period.days.includes(day.dayOfWeek));
    };
    // Visits should be measured in hours, not unbounded input spanning years.
    if (date.until(lastDate).days > 366) return undefined;
    while (Temporal.PlainDate.compare(date, lastDate) <= 0) {
      const day = { start: date.toZonedDateTime(data.timeZone).epochMilliseconds, end: date.add({ days: 1 }).toZonedDateTime(data.timeZone).epochMilliseconds };
      const hasOverride = lounge.hours.exceptions?.some(value => value.date === date.toString());
      const openingDays = hasOverride ? [date] : [date.subtract({ days: 1 }), date];
      for (const openingDay of openingDays) {
        for (const period of periodsFor(openingDay)) {
          const start = wallInstant(openingDay, period.open, data.timeZone);
          let end = wallInstant(openingDay, period.close, data.timeZone);
          if (end <= start) end = wallInstant(openingDay.add({ days: 1 }), period.close, data.timeZone);
          const daily = intersection({ start, end }, day);
          const clipped = daily && intersection(daily, requested);
          if (clipped) result.push(clipped);
        }
      }
      date = date.add({ days: 1 });
    }
    return mergeIntervals(result);
  } catch { return undefined; }
}

function evaluateRule(rule: LoungeAccessRule, context: LoungeVisitContext, requested: Interval): RuleResult {
  let mismatch = false;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const membership = expandLoungeMemberships(context.memberships);
  if (rule.membershipsAnyOf && !rule.membershipsAnyOf.some(value => membership.has(value))) {
    mismatch = true; reasons.push('A required lounge program or status is missing.');
  }
  if (rule.cabinsAnyOf) {
    if (!context.cabin) warnings.push('Confirm the cabin on this flight.');
    else if (!rule.cabinsAnyOf.includes(context.cabin)) { mismatch = true; reasons.push('This cabin does not qualify for this access route.'); }
  }
  for (const [field, selected, label] of [
    [rule.operatingCarriersAnyOf, context.operatingCarrier, 'operating airline'],
    [rule.marketingCarriersAnyOf, context.marketingCarrier, 'marketing airline'],
  ] as const) {
    if (!field) continue;
    if (!selected) warnings.push(`Confirm the ${label} on your booking.`);
    else if (!field.some(value => value.toUpperCase() === selected.trim().toUpperCase())) {
      mismatch = true; reasons.push(`The ${label} does not qualify for this access route.`);
    }
  }
  for (const [required, supplied, carrier, label] of [
    [rule.operatingAlliance, context.operatingAlliance, context.operatingCarrier, 'operating'],
    [rule.marketingAlliance, context.marketingAlliance, context.marketingCarrier, 'marketing'],
  ] as const) {
    if (!required) continue;
    const alliance = supplied ?? loungeCarrierAlliance(carrier);
    if (!alliance) {
      // A known carrier outside the required alliance is a mismatch; an absent/unmapped carrier remains unknown.
      if (carrier && NON_ALLIANCE_CARRIERS.has(carrier.trim().toUpperCase())) { mismatch = true; reasons.push(`The ${label} airline is outside the required alliance.`); }
      else warnings.push(`Confirm that the ${label} airline belongs to ${required === 'star' ? 'Star Alliance' : required === 'skyteam' ? 'SkyTeam' : 'oneworld'}.`);
    } else if (alliance !== required) { mismatch = true; reasons.push(`The ${label} airline is outside the required alliance.`); }
  }
  if (rule.route) {
    if (!context.route) warnings.push('Confirm whether this is a domestic or international departure.');
    else if (context.route !== rule.route) { mismatch = true; reasons.push(`This access route requires an ${rule.route === 'international' ? 'international' : 'eligible domestic'} flight.`); }
  }
  if (rule.destinationCountriesAnyOf || rule.excludedDestinationCountries) {
    if (!context.destinationCountry) warnings.push('Confirm the destination country for this access route.');
    else {
      const country = context.destinationCountry.toUpperCase();
      if ((rule.destinationCountriesAnyOf && !rule.destinationCountriesAnyOf.includes(country)) || rule.excludedDestinationCountries?.includes(country)) {
        mismatch = true; reasons.push('This destination does not qualify for this access route.');
      }
    }
  }
  const window = { ...requested };
  if (rule.maxMinutesBeforeDeparture !== undefined || rule.minMinutesBeforeDeparture !== undefined) {
    if (!context.departure) warnings.push('Choose a departure time to check the entry window.');
    else {
      try {
        const departure = epoch(context.departure);
        if (rule.maxMinutesBeforeDeparture !== undefined) {
          window.start = Math.max(window.start, departure - rule.maxMinutesBeforeDeparture * MINUTE);
          reasons.push(`Entry starts ${rule.maxMinutesBeforeDeparture / 60} hours before departure.`);
        }
        if (rule.minMinutesBeforeDeparture !== undefined) window.end = Math.min(window.end, departure - rule.minMinutesBeforeDeparture * MINUTE);
        if (window.end <= window.start) { mismatch = true; reasons.push('Your visit is outside this access route’s entry window.'); }
      } catch { warnings.push('The departure time could not be checked.'); }
    }
  }
  if (rule.maxVisitMinutes !== undefined) reasons.push(`Visits are limited to ${rule.maxVisitMinutes} minutes on this access route.`);
  if (rule.note) reasons.push(rule.note);
  warnings.push(...(rule.conditions ?? []));
  return { rule, access: mismatch ? 'ineligible' : warnings.length ? 'conditional' : 'eligible', reasons, warnings, window };
}

function reviewWarnings(lounge: Lounge, data: AirportLoungeData, context: LoungeVisitContext, rule?: LoungeAccessRule): string[] {
  const warnings: string[] = [];
  try {
    const today = Temporal.PlainDate.from((context.now ?? new Date().toISOString()).slice(0, 10));
    const dates = [data.updatedAt, ...lounge.sources.filter(source => !rule?.sourceIds || rule.sourceIds.includes(source.id)).map(source => source.checkedOn)];
    if (!lounge.sources.length || rule?.sourceIds?.some(id => !lounge.sources.some(source => source.id === id))) warnings.push('Access details need a source check.');
    if (dates.some(date => {
      const age = Temporal.PlainDate.from(date.slice(0, 10)).until(today).days;
      return age > REVIEW_DAYS || age < -1;
    })) warnings.push('These details were last checked over six months ago or need a review-date check.');
  } catch { warnings.push('These details need a review-date check.'); }
  return warnings;
}

function terminalKey(value: string): string {
  return value.toUpperCase().replace(/TERMINAL/g, 'T').replace(/[^A-Z0-9]/g, '');
}

function amenityScore(lounge: Lounge, context: LoungeVisitContext): number {
  const amenities = lounge.amenities;
  let score = (amenities.showers === 'yes' ? 10 : 0) + (amenities.quietArea === 'yes' ? 7 : 0) +
    (amenities.spa === 'yes' ? 3 : 0) + (amenities.wifi === 'yes' ? 2 : 0) +
    (amenities.dining === 'restaurant' ? 12 : amenities.dining === 'buffet' ? 8 : amenities.dining === 'snacks' ? 3 : 0);
  if (context.priority === 'showers' && amenities.showers === 'yes') score += 40;
  if (context.priority === 'quiet' && amenities.quietArea === 'yes') score += 40;
  if (context.priority === 'dining') score += amenities.dining === 'restaurant' ? 45 : amenities.dining === 'buffet' ? 25 : amenities.dining === 'snacks' ? 5 : 0;
  return score;
}

/** Unknown restrictions remain conditional. A confirmed access route never bypasses hours or terminal checks. */
export function evaluateLounge(lounge: Lounge, context: LoungeVisitContext, data: AirportLoungeData): LoungeEvaluation {
  let requested: Interval;
  const minimum = Math.max(1, context.minimumVisitMinutes ?? 30);
  try {
    requested = { start: epoch(context.visitStart), end: epoch(context.visitEnd) };
    if (requested.end <= requested.start || !Number.isFinite(minimum)) throw new RangeError('Invalid visit');
  } catch {
    return { lounge, access: 'ineligible', opening: 'unknown', matchedRuleIds: [], reasons: ['Choose a valid visit start and end.'], warnings: [], score: -1000, recommended: false };
  }
  const openings = lounge.status === 'temporarily-closed' ? [] : openingIntervals(lounge, data, requested);
  const opening = openings === undefined ? 'unknown' : openings.length ? 'open' : 'closed';
  const generalWarnings: string[] = [];
  if (!context.terminal) generalWarnings.push(`Check access to ${lounge.terminal} before choosing this lounge.`);
  else if (terminalKey(context.terminal) !== terminalKey(lounge.terminal)) generalWarnings.push(`Check the transfer from ${context.terminal} to ${lounge.terminal}, including security and immigration.`);
  if (!lounge.airside) generalWarnings.push('This lounge is landside; allow time for security before boarding.');
  if (opening === 'unknown') generalWarnings.push(lounge.hours.note ?? 'Opening hours depend on flights or have not been confirmed.');
  const rules = lounge.accessRules.map(rule => {
    const result = evaluateRule(rule, context, requested);
    result.warnings.push(...generalWarnings, ...reviewWarnings(lounge, data, context, rule));
    if (result.access !== 'ineligible' && result.warnings.length) result.access = 'conditional';
    const available = (openings ?? [requested]).map(period => intersection(period, result.window)).filter((value): value is Interval => Boolean(value));
    const longest = available.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    const visit = longest ? { ...longest, end: Math.min(longest.end, longest.start + (rule.maxVisitMinutes ?? Infinity) * MINUTE) } : undefined;
    return { ...result, visit };
  });
  const rank = { eligible: 2, conditional: 1, ineligible: 0 };
  rules.sort((a, b) => {
    // Prefer a usable route over an eligible route whose time allowance is already exhausted.
    const aUsable = a.visit && a.visit.end - a.visit.start >= minimum * MINUTE ? 1 : 0;
    const bUsable = b.visit && b.visit.end - b.visit.start >= minimum * MINUTE ? 1 : 0;
    const aFee = a.rule.additionalFee;
    const bFee = b.rule.additionalFee;
    // Absence of a documented surcharge is preferable, but is never described as free entry.
    const feeDifference = !aFee || !bFee || aFee.currency === bFee.currency ? (aFee?.amount ?? 0) - (bFee?.amount ?? 0) : 0;
    return (b.access !== 'ineligible' ? bUsable : 0) - (a.access !== 'ineligible' ? aUsable : 0) || rank[b.access] - rank[a.access] ||
      ((b.visit?.end ?? 0) - (b.visit?.start ?? 0)) - ((a.visit?.end ?? 0) - (a.visit?.start ?? 0)) || feeDifference ||
      a.warnings.length - b.warnings.length;
  });
  const best = rules[0];
  const visit = best?.visit ? { start: new Date(best.visit.start).toISOString(), end: new Date(best.visit.end).toISOString(), minutes: (best.visit.end - best.visit.start) / MINUTE } : undefined;
  const access = best?.access ?? 'ineligible';
  const reasons = best ? [best.access !== 'ineligible' ? best.rule.label : 'No listed access route matches your programs and flight.', ...best.reasons] : ['No access rules have been researched for this lounge.'];
  const warnings = best ? [...best.warnings] : [...generalWarnings, ...reviewWarnings(lounge, data, context)];
  if (opening === 'closed') reasons.push(lounge.status === 'temporarily-closed' ? 'This lounge is temporarily closed.' : 'Closed during your available visit.');
  if (visit && visit.minutes < minimum) warnings.push(`Only ${Math.floor(visit.minutes)} minutes are available; allow at least ${minimum} minutes for a useful visit.`);
  const usable = opening === 'open' && visit !== undefined && visit.minutes >= minimum;
  const score = (access === 'eligible' ? 100 : access === 'conditional' ? 30 : -1000) + amenityScore(lounge, context) +
    (usable ? Math.min(visit.minutes, 120) / 12 : -200) + (opening === 'closed' ? -500 : 0);
  const editorialBoost = access === 'eligible' && usable && lounge.recommendation?.bestFor?.includes(context.priority ?? 'balanced') ? 15 : 0;
  return { lounge, access, opening, matchedRuleIds: rules.filter(rule => rule.access !== 'ineligible').map(rule => rule.rule.id), selectedRuleId: best?.rule.id, reasons: unique(reasons), warnings: unique(warnings), visit, score: score + editorialBoost, recommended: false };
}

/** All researched lounges remain visible; the recommendation requires confirmed access and a usable opening. */
export function evaluateAirportLounges(data: AirportLoungeData, context: LoungeVisitContext): LoungeRecommendations {
  const results = data.lounges.map(lounge => evaluateLounge(lounge, context, data)).sort((a, b) => b.score - a.score || a.lounge.name.localeCompare(b.lounge.name));
  const recommended = results.find(result => result.access === 'eligible' && result.opening === 'open' && result.visit && result.visit.minutes >= Math.max(1, context.minimumVisitMinutes ?? 30));
  if (recommended) {
    recommended.recommended = true;
    const amenities = recommended.lounge.amenities;
    let fit: string | undefined;
    if (context.priority === 'showers' && amenities.showers === 'yes') fit = 'Showers are listed, matching your priority.';
    else if (context.priority === 'dining' && amenities.dining === 'restaurant') fit = 'Restaurant dining is listed, matching your priority.';
    else if (context.priority === 'dining' && amenities.dining === 'buffet') fit = 'A buffet is listed, matching your dining priority.';
    else if (context.priority === 'quiet' && amenities.quietArea === 'yes') fit = 'A quiet area is listed, matching your priority.';
    else if (amenities.showers === 'yes') fit = 'Showers are listed for a pre-flight refresh.';
    else if (amenities.dining === 'restaurant') fit = 'Restaurant dining is listed.';
    else if (amenities.dining === 'buffet') fit = 'A buffet is listed.';
    if (fit) recommended.reasons.push(fit);
    recommended.recommendationReason = fit ?? 'A useful visit fits your access and opening times.';
    recommended.reasons.push(`${Math.floor(recommended.visit!.minutes)} minutes are available within the opening and access windows.`);
    if (recommended.lounge.recommendation?.summary) recommended.reasons.push(`Research note: ${recommended.lounge.recommendation.summary}`);
  }
  return { results, recommendedId: recommended?.lounge.id ?? null };
}
