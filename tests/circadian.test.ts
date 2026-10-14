import { describe, expect, it } from 'vitest';
import {
  FORGER99_INITIAL_STATE, FORGER99_METADATA, FORGER99_PARAMETERS,
  entrainHabitual, estimateNadir, forgerDerivative, phaseHours, simulateForger,
  type CircadianSample, type CircadianState,
} from '../src/lib/circadian';
import fixture from './fixtures/circadian/forger99.json';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 0, 1);
const components = ['x', 'xc', 'n'] as const;
const initial = (values: number[]): CircadianState => ({ x: values[0], xc: values[1], n: values[2] });
function lightFunction(segments: number[][]) {
  let segment = 0;
  return (epoch: number) => {
    const hours = (epoch - START) / HOUR;
    while (segment < segments.length - 1 && hours >= segments[segment][1] - 1e-10) segment++;
    return segments[segment][2];
  };
}
function compare(samples: CircadianSample[], expected: number[][], intervalMinutes: number): number {
  let maximum = 0;
  const sampleStride = 30 / intervalMinutes;
  expected.forEach((state, i) => components.forEach((component, j) => {
    maximum = Math.max(maximum, Math.abs(samples[i * sampleStride][component] - state[j]));
  }));
  return maximum;
}

describe('Forger99 genuine reference port', () => {
  it('pins published parameters, actual source commit, and numerical rather than clinical validation', () => {
    expect(FORGER99_METADATA.referenceCommit).toBe(fixture.metadata.commit);
    expect(FORGER99_PARAMETERS).toEqual(fixture.metadata.parameters);
    expect(FORGER99_METADATA.clinicallyValidated).toBe(false);
    expect(fixture.metadata.independentSolver).toBe('scipy.integrate.solve_ivp/DOP853');
    expect(fixture.metadata.sourceSha256).toHaveLength(64);
  });
  for (const scenario of fixture.cases) {
    it(`matches upstream RK4 and independent SciPy over ${scenario.name}`, () => {
      const samples = simulateForger(initial(scenario.initial), START, START + scenario.durationHours * HOUR,
        lightFunction(scenario.lightSegments));
      // Fixtures come only from the actual upstream Python implementation;
      // their generator imports its derivatives and never reads this port.
      expect(compare(samples, scenario.referenceRk4FiveMinuteStates, 5)).toBeLessThan(5e-12);
      const independentError = compare(samples, scenario.scipyStates, 5);
      expect(independentError).toBeLessThan(scenario.convergence['5'].maxAbsStateError * 1.01 + 1e-10);
      expect(independentError).toBeLessThan(0.001);
    });
    it(`converges with timestep refinement for ${scenario.name}`, () => {
      const errors = [15, 5, 2.5].map((minutes) => compare(
        simulateForger(initial(scenario.initial), START, START + scenario.durationHours * HOUR,
          lightFunction(scenario.lightSegments), minutes), scenario.scipyStates, minutes));
      expect(errors[1]).toBeLessThan(errors[0]);
      expect(errors[2]).toBeLessThan(errors[1]);
      expect(errors[0] / errors[1]).toBeGreaterThan(25);
      expect(errors[1] / errors[2]).toBeGreaterThan(8);
    });
  }
  it('finds modeled x troughs within one timestep of the independent adaptive minima', () => {
    const scenario = fixture.cases.find(c => c.name === 'variable_lux_12_days')!;
    const samples = simulateForger(initial(scenario.initial), START, START + scenario.durationHours * HOUR,
      lightFunction(scenario.lightSegments));
    for (let day = 0; day < 12; day++) {
      const after = START + day * 24 * HOUR;
      const actual = estimateNadir(samples, after), expected = scenario.scipyNadirHours.find(h => h >= day * 24);
      expect(actual).not.toBeNull();
      expect(expected).not.toBeUndefined();
      expect(Math.abs(actual! - (START + expected! * HOUR))).toBeLessThan(5 * 60_000);
    }
  });
});

describe('circadian initialization and phase proxy', () => {
  it('entrains a habitual schedule at midnight, deterministically and without mutable cached state', () => {
    const a = entrainHabitual(7, 8);
    const b = entrainHabitual(7, 8);
    expect(a).toEqual(b);
    a.x = 3;
    expect(entrainHabitual(7, 8)).toEqual(b);
    const scenario = fixture.cases.find(c => c.name === 'habitual_28_days')!;
    const expected = scenario.referenceRk4FiveMinuteStates[21 * 48];
    expect(b.x).toBeCloseTo(expected[0], 12);
    expect(b.xc).toBeCloseTo(expected[1], 12);
    expect(b.n).toBeCloseTo(expected[2], 12);
  });
  it('calibrates the phase proxy to the actual canonical x nadir', () => {
    const samples = simulateForger(entrainHabitual(7, 8), 0, 24 * HOUR, t => t / HOUR >= 7 && t / HOUR < 23 ? 150 : 0);
    const nadir = estimateNadir(samples, 0)!;
    const i = Math.floor(nadir / (5 * 60_000));
    const a = samples[i], b = samples[i + 1], f = (nadir - a.time) / (b.time - a.time);
    const state = { x: a.x + f * (b.x - a.x), xc: a.xc + f * (b.xc - a.xc), n: a.n + f * (b.n - a.n) };
    const phase = phaseHours(state);
    expect(Math.min(phase, 24 - phase)).toBeLessThan(1e-10);
    expect(phaseHours(samples[84])).toBeGreaterThan(0);
    expect(phaseHours(samples[84])).toBeLessThan(24);
  });
  it('keeps initialization and phase inputs bounded', () => {
    for (const args of [[NaN, 8, 21], [24, 8, 21], [7, 3, 21], [7, 13, 21], [7, 8, 0], [7, 8, 91], [7, 8, 1.5]]) {
      expect(() => entrainHabitual(...args as [number, number, number])).toThrow();
    }
    expect(() => phaseHours({ x: 0, xc: 0, n: 0.5 })).toThrow('undefined');
  });
});

describe('bounded integration and nadir extraction', () => {
  it('includes endpoints, handles a short final step, and does not mutate the initial state', () => {
    const state = { ...FORGER99_INITIAL_STATE };
    const times: number[] = [];
    const samples = simulateForger(state, START, START + 12.35 * 60_000, t => { times.push(t); return 0; });
    expect(samples).toHaveLength(4);
    expect(samples[0].time).toBe(START);
    expect(samples.at(-1)!.time).toBe(START + 12.35 * 60_000);
    expect(times).toEqual([START, START + 5 * 60_000, START + 10 * 60_000]);
    expect(state).toEqual(FORGER99_INITIAL_STATE);
    expect(simulateForger(state, START, START, () => { throw new Error('not needed'); })).toEqual([{ ...state, time: START }]);
  });
  it('rejects nonfinite/out-of-range state, lux, time, timestep and CPU budgets', () => {
    for (const state of [{ x: NaN, xc: 0, n: 0.5 }, { x: 5, xc: 0, n: 0.5 }, { x: 0, xc: 0, n: -0.1 }]) {
      expect(() => simulateForger(state, START, START + HOUR, () => 0)).toThrow();
    }
    for (const lux of [-1, NaN, Infinity, 100_001]) {
      expect(() => simulateForger(FORGER99_INITIAL_STATE, START, START + HOUR, () => lux)).toThrow();
    }
    for (const minutes of [NaN, 0.1, 16]) {
      expect(() => simulateForger(FORGER99_INITIAL_STATE, START, START + HOUR, () => 0, minutes)).toThrow();
    }
    expect(() => simulateForger(FORGER99_INITIAL_STATE, NaN, START, () => 0)).toThrow();
    expect(() => simulateForger(FORGER99_INITIAL_STATE, START, START - 1, () => 0)).toThrow();
    expect(() => simulateForger(FORGER99_INITIAL_STATE, START, START + 181 * 24 * HOUR, () => 0)).toThrow();
    expect(() => simulateForger(FORGER99_INITIAL_STATE, START, START + 180 * 24 * HOUR, () => 0, 0.25)).toThrow('budget');
    expect(() => forgerDerivative(FORGER99_INITIAL_STATE, -1)).toThrow();
  });
  it('remains finite at maximum permitted lux without clipping the photic state', () => {
    const samples = simulateForger(FORGER99_INITIAL_STATE, START, START + 24 * HOUR, () => 100_000);
    expect(samples.every(s => Number.isFinite(s.x) && Number.isFinite(s.xc) && s.n >= 0 && s.n <= 1)).toBe(true);
  });
  it('uses local minima, excludes endpoints, interpolates unequal spacing and honors after', () => {
    const samples = [1, 2, 2.5].map(h => ({ time: h * HOUR, x: (h - 2) ** 2, xc: 0, n: 0.5 }));
    expect(estimateNadir(samples, 0)).toBeCloseTo(2 * HOUR, 8);
    expect(estimateNadir(samples, 2 * HOUR + 1)).toBeNull();
    expect(estimateNadir(samples.slice(0, 2), 0)).toBeNull();
    expect(estimateNadir([], 0)).toBeNull();
    expect(() => estimateNadir([samples[1], samples[0]], 0)).toThrow('increase');
  });
});
