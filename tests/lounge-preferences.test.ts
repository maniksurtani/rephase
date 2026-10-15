import { describe, expect, it } from 'vitest';
import { createInitialData } from '../src/lib/defaults';
import { LOUNGE_MEMBERSHIPS } from '../src/lib/lounge-types';
import { mergeAppData } from '../src/lib/merge';
import { validateAppData } from '../src/lib/validation';

describe('saved lounge preferences', () => {
  it('accepts existing schema-1 data without lounge preferences', () => {
    const data = createInitialData();
    delete data.preferences.loungeMemberships;
    delete data.preferences.loungePriority;
    expect(validateAppData(data)).toBeNull();
  });

  it('accepts supported memberships and all recommendation priorities', () => {
    for (const loungePriority of ['balanced', 'showers', 'dining', 'quiet'] as const) {
      const data = createInitialData();
      data.preferences.loungeMemberships = LOUNGE_MEMBERSHIPS.map(program => program.id);
      data.preferences.loungePriority = loungePriority;
      expect(validateAppData(data)).toBeNull();
    }
    const data = createInitialData();
    data.preferences.loungeMemberships = [];
    expect(validateAppData(data)).toBeNull();
  });

  it.each([
    ['unknown membership', { loungeMemberships: ['made-up-program'] }],
    ['duplicate membership', { loungeMemberships: ['priority-pass', 'priority-pass'] }],
    ['too many memberships', { loungeMemberships: Array.from({ length: LOUNGE_MEMBERSHIPS.length + 1 }, () => 'priority-pass') }],
    ['non-array membership', { loungeMemberships: 'priority-pass' }],
    ['non-string membership', { loungeMemberships: [null] }],
    ['unknown priority', { loungePriority: 'spa' }],
    ['non-string priority', { loungePriority: null }],
  ])('rejects %s', (_label, values) => {
    const data = createInitialData();
    Object.assign(data.preferences, values);
    expect(validateAppData(data)).toBe('Saved preferences contain an invalid value.');
  });

  it('merges independent lounge and sleep preference edits from two devices', () => {
    const base = createInitialData();
    const local = structuredClone(base), remote = structuredClone(base);
    local.preferences.loungeMemberships = ['priority-pass', 'qantas-platinum'];
    local.preferences.loungePriority = 'showers';
    remote.preferences.sleepHours = 9;
    remote.preferences.preferredWakeTime = '08:00';
    const result = mergeAppData(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.data.preferences).toMatchObject({
      loungeMemberships: ['priority-pass', 'qantas-platinum'], loungePriority: 'showers',
      sleepHours: 9, preferredWakeTime: '08:00',
    });
    expect(validateAppData(result.data)).toBeNull();
  });

  it('flags conflicting membership edits instead of silently combining benefits', () => {
    const base = createInitialData();
    base.preferences.loungeMemberships = ['priority-pass'];
    const local = structuredClone(base), remote = structuredClone(base);
    local.preferences.loungeMemberships = ['qantas-platinum'];
    remote.preferences.loungeMemberships = ['star-gold'];
    const result = mergeAppData(base, local, remote);
    expect(result.conflicts).toEqual(['preferences.loungeMemberships']);
    expect(result.data.preferences.loungeMemberships).toEqual(['qantas-platinum']);
  });
});
