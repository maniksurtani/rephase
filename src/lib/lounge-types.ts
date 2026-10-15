import type { TravelClass } from './types';

export const LOUNGE_MEMBERSHIPS = [
  { id: 'priority-pass', label: 'Priority Pass' },
  { id: 'qantas-gold', label: 'Qantas Gold' },
  { id: 'qantas-platinum', label: 'Qantas Platinum' },
  { id: 'qantas-platinum-one', label: 'Qantas Platinum One' },
  { id: 'qantas-club', label: 'Qantas Club' },
  { id: 'oneworld-sapphire', label: 'oneworld Sapphire' },
  { id: 'oneworld-emerald', label: 'oneworld Emerald' },
  { id: 'star-gold', label: 'Star Alliance Gold' },
  { id: 'united-club', label: 'United Club' },
  { id: 'alaska-lounge-plus', label: 'Alaska Lounge+' },
  { id: 'admirals-club', label: 'Admirals Club' },
  { id: 'skyteam-elite-plus', label: 'SkyTeam Elite Plus' },
] as const;

export type LoungeMembership = typeof LOUNGE_MEMBERSHIPS[number]['id'];
export type LoungeAlliance = 'oneworld' | 'star' | 'skyteam';
export type LoungeAmenity = 'yes' | 'no' | 'unknown';
export type LoungePriority = 'balanced' | 'showers' | 'dining' | 'quiet';

export interface LoungeSource { id: string; title: string; url: string; checkedOn: string }
export interface LoungePhoto { path: string; alt: string; credit: string; license: string; sourceUrl: string }
export interface LoungeOpeningPeriod {
  /** ISO weekdays: Monday = 1, Sunday = 7. An overnight period belongs to its opening day. */
  days: number[]; open: string; close: string;
}
export interface LoungeHours {
  type: 'weekly' | 'flight-dependent' | 'unknown';
  periods?: LoungeOpeningPeriod[];
  note?: string;
  /** Airport-local date overrides. An empty periods array means closed that day. */
  exceptions?: { date: string; periods: { open: string; close: string }[]; note?: string }[];
}
export interface LoungeAccessRule {
  id: string; label: string;
  /** Rules are OR; populated fields within a rule are AND. */
  membershipsAnyOf?: LoungeMembership[];
  cabinsAnyOf?: TravelClass[];
  operatingCarriersAnyOf?: string[];
  marketingCarriersAnyOf?: string[];
  operatingAlliance?: LoungeAlliance;
  marketingAlliance?: LoungeAlliance;
  route?: 'domestic' | 'international';
  destinationCountriesAnyOf?: string[];
  excludedDestinationCountries?: string[];
  maxMinutesBeforeDeparture?: number;
  minMinutesBeforeDeparture?: number;
  maxVisitMinutes?: number;
  /** An unavoidable extra entry charge; separate from optional treatments or shower fees. */
  additionalFee?: { amount: number; currency: string };
  /** Unencoded restrictions always require verification; never treated as guaranteed access. */
  conditions?: string[];
  /** Informational text, for example a charge or guest policy. */
  note?: string;
  sourceIds?: string[];
}
export interface Lounge {
  id: string; name: string; terminal: string; location: string; airside: boolean;
  status: 'open' | 'temporarily-closed';
  hours: LoungeHours;
  amenities: {
    showers: LoungeAmenity; dining: 'restaurant' | 'buffet' | 'snacks' | 'none' | 'unknown';
    spa: LoungeAmenity; quietArea: LoungeAmenity; wifi: LoungeAmenity;
  };
  accessRules: LoungeAccessRule[];
  sources: LoungeSource[];
  photos: LoungePhoto[];
  /** Editorial findings from offline research, with no invented numeric review score. */
  recommendation?: { summary: string; bestFor?: LoungePriority[] };
  note?: string;
}
export interface AirportLoungeData {
  $schema?: string; schemaVersion: 1; airport: string; timeZone: string; updatedAt: string;
  lounges: Lounge[];
}
export interface LoungeVisitContext {
  memberships: LoungeMembership[];
  cabin?: TravelClass;
  /** Supply an operating carrier only after confirmation; flight-number prefixes can be codeshares. */
  operatingCarrier?: string;
  marketingCarrier?: string;
  operatingAlliance?: LoungeAlliance;
  marketingAlliance?: LoungeAlliance;
  route?: 'domestic' | 'international';
  destinationCountry?: string;
  /** Match the dataset's terminal text; missing/different terminals require a transfer check. */
  terminal?: string;
  /** UTC instants covering the usable visit window, after security/immigration and before boarding. */
  visitStart: string; visitEnd: string;
  departure?: string;
  minimumVisitMinutes?: number;
  priority?: LoungePriority;
  /** Testable review-date reference; defaults to the current date. */
  now?: string;
}
export interface LoungeEvaluation {
  lounge: Lounge;
  access: 'eligible' | 'conditional' | 'ineligible';
  opening: 'open' | 'closed' | 'unknown';
  matchedRuleIds: string[];
  /** The single access route used for the proposed visit, fees and restrictions. */
  selectedRuleId?: string;
  reasons: string[];
  warnings: string[];
  /** Longest continuous usable opening, clipped to the requested visit. */
  visit?: { start: string; end: string; minutes: number };
  score: number;
  recommended: boolean;
  recommendationReason?: string;
}
export interface LoungeRecommendations {
  results: LoungeEvaluation[];
  recommendedId: string | null;
}
