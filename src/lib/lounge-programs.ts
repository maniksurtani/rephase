/** Curated program names and published alliance tiers. Access rules remain lounge-specific. */
export type LoyaltyAllianceTier =
  | 'oneworld-ruby'
  | 'oneworld-sapphire'
  | 'oneworld-emerald'
  | 'star-silver'
  | 'star-gold'
  | 'skyteam-elite'
  | 'skyteam-elite-plus';

export interface LoyaltyTier<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly allianceTier?: LoyaltyAllianceTier;
}
export interface LoyaltyProgramSource {
  readonly url: string;
  readonly title: string;
  readonly checkedOn: string;
}
export interface LoyaltyProgram {
  readonly id: string;
  readonly name: string;
  readonly airline: string;
  readonly keywords: readonly string[];
  /** Entry-level membership comes first, followed by ascending published status tiers. */
  readonly tiers: readonly LoyaltyTier[];
  readonly sources: readonly LoyaltyProgramSource[];
}

// Keep literal IDs for the shared browser/Worker preference validator. The optional
// alliance field remains accessible when iterating programs with different tiers.
const tier = <const Id extends string>(
  id: Id,
  label: string,
  allianceTier?: LoyaltyAllianceTier,
): LoyaltyTier<Id> => ({ id, label, ...(allianceTier ? { allianceTier } : {}) });
const source = (url: string, title: string): LoyaltyProgramSource => ({
  url,
  title,
  checkedOn: '2026-10-16',
});

export const LOYALTY_PROGRAMS = [
  {
    id: 'qantas',
    name: 'Qantas Frequent Flyer',
    airline: 'Qantas',
    keywords: ['QF', 'oneworld', 'Australia'],
    tiers: [
      tier('qantas-bronze', 'Bronze'),
      tier('qantas-silver', 'Silver', 'oneworld-ruby'),
      tier('qantas-gold', 'Gold', 'oneworld-sapphire'),
      tier('qantas-platinum', 'Platinum', 'oneworld-emerald'),
      tier('qantas-platinum-one', 'Platinum One', 'oneworld-emerald'),
    ],
    sources: [
      source(
        'https://www.qantas.com/au/en/frequent-flyer/status-and-clubs/status/bronze.html',
        'Qantas Bronze membership',
      ),
      source('https://www.oneworld.com/members/qantas', 'oneworld: Qantas status tiers'),
    ],
  },
  {
    id: 'united-mileageplus',
    name: 'United MileagePlus',
    airline: 'United Airlines',
    keywords: ['UA', 'Premier', '1K', 'Star Alliance'],
    tiers: [
      tier('united-member', 'Member'),
      tier('united-premier-silver', 'Premier Silver', 'star-silver'),
      tier('united-premier-gold', 'Premier Gold', 'star-gold'),
      tier('united-premier-platinum', 'Premier Platinum', 'star-gold'),
      tier('united-premier-1k', 'Premier 1K', 'star-gold'),
    ],
    sources: [
      source(
        'https://www.united.com/en/us/fly/mileageplus/premier/benefits.html',
        'United Premier status and Star Alliance benefits',
      ),
    ],
  },
  {
    id: 'american-aadvantage',
    name: 'American AAdvantage',
    airline: 'American Airlines',
    keywords: ['AA', 'oneworld'],
    tiers: [
      tier('american-member', 'Member'),
      tier('american-gold', 'Gold', 'oneworld-ruby'),
      tier('american-platinum', 'Platinum', 'oneworld-sapphire'),
      tier('american-platinum-pro', 'Platinum Pro', 'oneworld-emerald'),
      tier('american-executive-platinum', 'Executive Platinum', 'oneworld-emerald'),
    ],
    sources: [
      source(
        'https://www.oneworld.com/members/american-airlines',
        'oneworld: American AAdvantage status tiers',
      ),
    ],
  },
  {
    id: 'atmos-rewards',
    name: 'Atmos Rewards',
    airline: 'Alaska Airlines and Hawaiian Airlines',
    keywords: [
      'AS',
      'HA',
      'Alaska',
      'Hawaiian',
      'Mileage Plan',
      'HawaiianMiles',
      'MVP',
      'oneworld',
    ],
    tiers: [
      tier('atmos-member', 'Member'),
      tier('atmos-silver', 'Silver', 'oneworld-ruby'),
      tier('atmos-gold', 'Gold', 'oneworld-sapphire'),
      tier('atmos-platinum', 'Platinum', 'oneworld-emerald'),
      tier('atmos-titanium', 'Titanium', 'oneworld-emerald'),
    ],
    sources: [
      source(
        'https://www.oneworld.com/members/alaska-airlines',
        'oneworld: Alaska and Atmos Rewards status tiers',
      ),
    ],
  },
  {
    id: 'delta-skymiles',
    name: 'Delta SkyMiles',
    airline: 'Delta Air Lines',
    keywords: ['DL', 'Medallion', 'SkyTeam'],
    tiers: [
      tier('delta-member', 'Member'),
      tier('delta-silver-medallion', 'Silver Medallion', 'skyteam-elite'),
      tier('delta-gold-medallion', 'Gold Medallion', 'skyteam-elite-plus'),
      tier('delta-platinum-medallion', 'Platinum Medallion', 'skyteam-elite-plus'),
      tier('delta-diamond-medallion', 'Diamond Medallion', 'skyteam-elite-plus'),
    ],
    sources: [
      source(
        'https://www.delta.com/us/en/skymiles/medallion-program/medallion-benefits',
        'Delta Medallion benefits',
      ),
      source(
        'https://www.delta.com/us/en/skymiles/medallion-program/international-partner-skyteam-benefits',
        'Delta international partner and SkyTeam benefits',
      ),
    ],
  },
  {
    id: 'british-airways-club',
    name: 'The British Airways Club',
    airline: 'British Airways',
    keywords: ['BA', 'Executive Club', 'Avios', 'oneworld'],
    tiers: [
      tier('british-airways-blue', 'Blue'),
      tier('british-airways-bronze', 'Bronze', 'oneworld-ruby'),
      tier('british-airways-silver', 'Silver', 'oneworld-sapphire'),
      tier('british-airways-gold', 'Gold', 'oneworld-emerald'),
    ],
    sources: [
      source(
        'https://www.britishairways.com/content/the-british-airways-club/about-the-club/tiers-and-benefits',
        'The British Airways Club tiers and benefits',
      ),
      source(
        'https://www.oneworld.com/members/british-airways',
        'oneworld: British Airways status tiers',
      ),
    ],
  },
  {
    id: 'cathay',
    name: 'Cathay',
    airline: 'Cathay Pacific',
    keywords: ['CX', 'Asia Miles', 'Marco Polo Club', 'oneworld'],
    tiers: [
      tier('cathay-green', 'Green'),
      tier('cathay-silver', 'Silver', 'oneworld-ruby'),
      tier('cathay-gold', 'Gold', 'oneworld-sapphire'),
      tier('cathay-diamond', 'Diamond', 'oneworld-emerald'),
    ],
    sources: [
      source('https://www.oneworld.com/members/cathay-pacific', 'oneworld: Cathay status tiers'),
    ],
  },
  {
    id: 'air-canada-aeroplan',
    name: 'Air Canada Aeroplan',
    airline: 'Air Canada',
    keywords: ['AC', 'Star Alliance', 'Super Elite'],
    tiers: [
      tier('aeroplan-member', 'Member'),
      tier('aeroplan-25k', '25K', 'star-silver'),
      tier('aeroplan-35k', '35K', 'star-silver'),
      tier('aeroplan-50k', '50K', 'star-gold'),
      tier('aeroplan-75k', '75K', 'star-gold'),
      tier('aeroplan-super-elite', 'Super Elite', 'star-gold'),
    ],
    sources: [
      source(
        'https://www.aircanada.com/ca/en/aco/home/aeroplan/status/tiers.html',
        'Air Canada Aeroplan Elite Status tiers',
      ),
    ],
  },
  {
    id: 'singapore-krisflyer',
    name: 'Singapore Airlines KrisFlyer',
    airline: 'Singapore Airlines',
    keywords: ['SQ', 'Star Alliance'],
    tiers: [
      tier('krisflyer-member', 'Member'),
      tier('krisflyer-elite-silver', 'Elite Silver', 'star-silver'),
      tier('krisflyer-elite-gold', 'Elite Gold', 'star-gold'),
    ],
    sources: [
      source(
        'https://www.singaporeair.com/en_UK/sg/ppsclub-krisflyer/krisflyer/krisflyer-privileges/',
        'Singapore Airlines KrisFlyer and Elite privileges',
      ),
      source(
        'https://www.singaporeair.com/en_UK/sg/ppsclub-krisflyer/krisflyer/krisflyer-elite-gold/',
        'Singapore Airlines KrisFlyer Elite Gold',
      ),
    ],
  },
  {
    id: 'emirates-skywards',
    name: 'Emirates Skywards',
    airline: 'Emirates',
    keywords: ['EK', 'flydubai', 'FZ'],
    tiers: [
      tier('emirates-blue', 'Blue'),
      tier('emirates-silver', 'Silver'),
      tier('emirates-gold', 'Gold'),
      tier('emirates-platinum', 'Platinum'),
    ],
    sources: [
      source(
        'https://www.emirates.com/english/skywards/membership-tiers/',
        'Emirates Skywards membership tiers',
      ),
    ],
  },
  {
    id: 'virgin-australia-velocity',
    name: 'Velocity Frequent Flyer',
    airline: 'Virgin Australia',
    keywords: ['VA', 'Australia'],
    tiers: [
      tier('velocity-red', 'Red'),
      tier('velocity-silver', 'Silver'),
      tier('velocity-gold', 'Gold'),
      tier('velocity-platinum', 'Platinum'),
      tier('velocity-platinum-plus', 'Platinum Plus'),
    ],
    sources: [
      source(
        'https://www.velocityfrequentflyer.com/the-basics/status',
        'Velocity membership status levels',
      ),
    ],
  },
  {
    id: 'air-new-zealand-koru',
    name: 'Air New Zealand Koru',
    airline: 'Air New Zealand',
    keywords: ['NZ', 'Airpoints', 'Elite', 'Star Alliance'],
    tiers: [
      tier('koru-bronze', 'Bronze'),
      tier('koru-silver', 'Silver', 'star-silver'),
      tier('koru-gold', 'Gold', 'star-gold'),
      tier('koru-platinum', 'Platinum', 'star-gold'),
      tier('koru-black', 'Black', 'star-gold'),
    ],
    sources: [
      source('https://www.airnewzealand.com/en-nz/koru', 'Air New Zealand Koru loyalty programme'),
      source(
        'https://www.airnewzealand.com/en-nz/koru/tiers/koru-silver',
        'Koru Silver and Star Alliance Silver',
      ),
      source(
        'https://www.airnewzealand.com/en-nz/koru/tiers/koru-gold',
        'Koru Gold and Star Alliance Gold',
      ),
      source(
        'https://www.airnewzealand.com/en-nz/koru/tiers/koru-platinum',
        'Koru Platinum and Star Alliance Gold',
      ),
      source(
        'https://www.airnewzealand.com/en-nz/koru/tiers/koru-black',
        'Koru Black and Star Alliance Gold',
      ),
    ],
  },
  {
    id: 'miles-and-more',
    name: 'Miles & More',
    airline: 'Lufthansa Group and partner airlines',
    keywords: [
      'LH',
      'LX',
      'OS',
      'SN',
      'Lufthansa',
      'SWISS',
      'Austrian',
      'Brussels',
      'Star Alliance',
    ],
    tiers: [
      tier('miles-and-more-member', 'Member'),
      tier('miles-and-more-frequent-traveller', 'Frequent Traveller', 'star-silver'),
      tier('miles-and-more-senator', 'Senator', 'star-gold'),
      tier('miles-and-more-hon-circle', 'HON Circle Member', 'star-gold'),
    ],
    sources: [
      source(
        'https://www.miles-and-more.com/row/en/program/status-benefits/status-levels.html',
        'Miles & More status levels',
      ),
      source(
        'https://www.miles-and-more.com/row/en/program/status-benefits/frequent-traveller-status.html',
        'Miles & More Frequent Traveller and Star Alliance Silver',
      ),
      source(
        'https://www.miles-and-more.com/row/en/program/status-benefits/hon-circle-status.html',
        'Miles & More HON Circle and Star Alliance Gold',
      ),
    ],
  },
] as const satisfies readonly LoyaltyProgram[];

export type LoyaltyStatusId = (typeof LOYALTY_PROGRAMS)[number]['tiers'][number]['id'];

const normalizeSearch = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Search names, airlines, aliases and tier names; every query token must match. */
export function searchLoyaltyPrograms(query: string): readonly (typeof LOYALTY_PROGRAMS)[number][] {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return LOYALTY_PROGRAMS.filter((program) => {
    const searchable = normalizeSearch(
      [
        program.name,
        program.airline,
        ...program.keywords,
        ...program.tiers.map((item) => item.label),
      ].join(' '),
    );
    return tokens.every((token) => searchable.includes(token));
  });
}
