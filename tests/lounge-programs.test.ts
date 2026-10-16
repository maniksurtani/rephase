import { describe, expect, it } from 'vitest';
import { LOYALTY_PROGRAMS, searchLoyaltyPrograms } from '../src/lib/lounge-programs';

const program = (id: string) => LOYALTY_PROGRAMS.find(item => item.id === id)!;

describe('loyalty program catalog', () => {
  it('keeps program and persisted status IDs unique with an explicit no-status first tier', () => {
    const programIds = LOYALTY_PROGRAMS.map(item => item.id);
    const tierIds = LOYALTY_PROGRAMS.flatMap(item => item.tiers.map(tier => tier.id));
    expect(new Set(programIds).size).toBe(programIds.length);
    expect(new Set(tierIds).size).toBe(tierIds.length);
    for (const entry of LOYALTY_PROGRAMS) {
      expect(entry.tiers.length).toBeGreaterThan(1);
      expect(entry.tiers[0].allianceTier).toBeUndefined();
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const evidence of entry.sources) {
        expect(new URL(evidence.url).protocol).toBe('https:');
        expect(evidence.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('preserves saved Qantas IDs and separates Silver from lounge-eligible alliance tiers', () => {
    expect(program('qantas').tiers).toEqual(expect.arrayContaining([
      { id: 'qantas-gold', label: 'Gold', allianceTier: 'oneworld-sapphire' },
      { id: 'qantas-platinum', label: 'Platinum', allianceTier: 'oneworld-emerald' },
      { id: 'qantas-platinum-one', label: 'Platinum One', allianceTier: 'oneworld-emerald' },
    ]));
    expect(program('qantas').tiers.find(item => item.id === 'qantas-silver')?.allianceTier).toBe('oneworld-ruby');
  });

  it('represents United Premier 1K without treating Premier Silver as Star Gold', () => {
    const united = program('united-mileageplus');
    expect(united.tiers.find(item => item.id === 'united-premier-1k')).toEqual({
      id: 'united-premier-1k', label: 'Premier 1K', allianceTier: 'star-gold',
    });
    expect(united.tiers.find(item => item.id === 'united-premier-silver')?.allianceTier).toBe('star-silver');
    expect(united.tiers.some(item => item.id === 'united-club')).toBe(false);
  });

  it('uses current Atmos levels rather than persisting retired Alaska or Hawaiian tiers', () => {
    expect(program('atmos-rewards').tiers.map(item => item.label)).toEqual(['Member', 'Silver', 'Gold', 'Platinum', 'Titanium']);
    expect(searchLoyaltyPrograms('HawaiianMiles').map(item => item.id)).toEqual(['atmos-rewards']);
    expect(searchLoyaltyPrograms('Mileage Plan').map(item => item.id)).toEqual(['atmos-rewards']);
  });

  it('retains non-alliance tiers without inventing reciprocal alliance status', () => {
    for (const id of ['emirates-skywards', 'virgin-australia-velocity']) {
      expect(program(id).tiers.every(item => item.allianceTier === undefined)).toBe(true);
    }
    expect(program('virgin-australia-velocity').tiers.at(-1)?.label).toBe('Platinum Plus');
    expect(program('air-canada-aeroplan').tiers.find(item => item.id === 'aeroplan-35k')?.allianceTier).toBe('star-silver');
    expect(program('air-new-zealand-koru').tiers.find(item => item.id === 'koru-black')?.allianceTier).toBe('star-gold');
  });
});

describe('loyalty program search', () => {
  it('matches airline, current program name, aliases and tier names', () => {
    expect(searchLoyaltyPrograms('1k').map(item => item.id)).toEqual(['united-mileageplus']);
    expect(searchLoyaltyPrograms('Executive Club').map(item => item.id)).toEqual(['british-airways-club']);
    expect(searchLoyaltyPrograms('Swiss').map(item => item.id)).toEqual(['miles-and-more']);
    expect(searchLoyaltyPrograms('Singapore Elite Gold').map(item => item.id)).toEqual(['singapore-krisflyer']);
    expect(searchLoyaltyPrograms('Airpoints Elite').map(item => item.id)).toEqual(['air-new-zealand-koru']);
  });

  it('normalizes case, accents, Unicode width, punctuation and extra spaces', () => {
    expect(searchLoyaltyPrograms('  ÉMIRATES   skywards ').map(item => item.id)).toEqual(['emirates-skywards']);
    expect(searchLoyaltyPrograms('ＭＩＬＥＳ ＆ ＭＯＲＥ').map(item => item.id)).toEqual(['miles-and-more']);
  });

  it('requires all search terms while keeping deterministic catalog ordering', () => {
    expect(searchLoyaltyPrograms('United Platinum').map(item => item.id)).toEqual(['united-mileageplus']);
    expect(searchLoyaltyPrograms('Qantas 1K')).toEqual([]);
    expect(searchLoyaltyPrograms('   ')).toEqual(LOYALTY_PROGRAMS);
    expect(searchLoyaltyPrograms('Star Alliance').length).toBeGreaterThan(1);
  });
});
