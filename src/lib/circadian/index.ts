/**
 * Forger, Jewett & Kronauer (1999), via the MIT-licensed Arcascope reference.
 * Derivatives/parameters: circadian/models.py, commit db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a.
 * State and time trajectories have numerical reference checks, not clinical validation.
 * See THIRD_PARTY_NOTICES.md and scripts/verify-circadian-reference.py.
 */
export interface CircadianState { x: number; xc: number; n: number }
export interface CircadianSample extends CircadianState { time: number }

export const FORGER99_METADATA = Object.freeze({
  name: 'Forger99', version: 'forger99-arcascope-1.0.3-rk4-1',
  referenceCommit: 'db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a',
  numericallyVerified: true, clinicallyValidated: false,
});
export const FORGER99_PARAMETERS = Object.freeze({
  taux: 24.2, mu: 0.23, G: 33.75, alpha_0: 0.05, beta: 0.0075,
  p: 0.5, I0: 9500, k: 0.55, cbt_to_dlmo: 7,
});
export const FORGER99_INITIAL_STATE: Readonly<CircadianState> = Object.freeze({
  x: -0.0843259, xc: -1.09607546, n: 0.45584306,
});
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const angularRate = Math.PI / 12;
const tauTerm = (24 / (0.99669 * FORGER99_PARAMETERS.taux)) ** 2;
const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

function validateState(state: CircadianState): void {
  if (!state || ![state.x, state.xc, state.n].every(Number.isFinite)
      || Math.abs(state.x) > 4 || Math.abs(state.xc) > 4 || state.n < -1e-8 || state.n > 1 + 1e-8) {
    throw new RangeError('Circadian state must be finite, with |x|/|xc| ≤ 4 and n between 0 and 1.');
  }
}
function validateTime(time: number): void {
  if (!Number.isFinite(time) || Math.abs(time) > 8.64e15) throw new RangeError('Invalid simulation epoch.');
}

/** Published right-hand side, time unit hours and light input lux. */
export function forgerDerivative(state: CircadianState, lux: number): CircadianState {
  validateState(state);
  if (!Number.isFinite(lux) || lux < 0 || lux > 100_000) throw new RangeError('Light must be between 0 and 100,000 lux.');
  return derivative(state, lux);
}
function derivative(state: CircadianState, lux: number): CircadianState {
  const p = FORGER99_PARAMETERS;
  const alpha = p.alpha_0 * (lux / p.I0) ** p.p;
  const Bhat = p.G * (1 - state.n) * alpha * (1 - 0.4 * state.x) * (1 - 0.4 * state.xc);
  return {
    x: angularRate * (state.xc + Bhat),
    xc: angularRate * (p.mu * (state.xc - 4 / 3 * state.xc ** 3) - state.x * (tauTerm + p.k * Bhat)),
    n: 60 * (alpha * (1 - state.n) - p.beta * state.n),
  };
}
function add(state: CircadianState, derivative: CircadianState, amount: number): CircadianState {
  return { x: state.x + derivative.x * amount, xc: state.xc + derivative.xc * amount, n: state.n + derivative.n * amount };
}
function step(state: CircadianState, lux: number, dtHours: number): CircadianState {
  // No phase-rate assumption, analytic phase override, or state clipping is applied.
  const k1 = derivative(state, lux);
  const k2 = derivative(add(state, k1, dtHours / 2), lux);
  const k3 = derivative(add(state, k2, dtHours / 2), lux);
  const k4 = derivative(add(state, k3, dtHours), lux);
  return {
    x: state.x + dtHours / 6 * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    xc: state.xc + dtHours / 6 * (k1.xc + 2 * k2.xc + 2 * k3.xc + k4.xc),
    n: state.n + dtHours / 6 * (k1.n + 2 * k2.n + 2 * k3.n + k4.n),
  };
}

/**
 * Fixed-timestep classical RK4. Light is sampled at each interval's LEFT endpoint
 * and held constant through its four stages. Align light transitions to step
 * boundaries; a transition inside a step is delayed to the next boundary.
 * Includes both endpoints, with a shorter final step if needed. All epochs are ms.
 */
export function simulateForger(
  initial: CircadianState, startEpochMs: number, endEpochMs: number,
  lightAt: (epochMs: number) => number, stepMinutes = 5,
): CircadianSample[] {
  validateState(initial); validateTime(startEpochMs); validateTime(endEpochMs);
  if (typeof lightAt !== 'function' || !Number.isFinite(stepMinutes) || stepMinutes < 0.25 || stepMinutes > 15
      || endEpochMs < startEpochMs || endEpochMs - startEpochMs > 180 * DAY) {
    throw new RangeError('Simulation needs a light function, 0.25–15 minute steps, and a forward interval of at most 180 days.');
  }
  const stepMs = stepMinutes * 60_000;
  const count = Math.ceil((endEpochMs - startEpochMs) / stepMs);
  if (count > 100_000) throw new RangeError('Simulation exceeds the 100,000-step budget.');
  const samples: CircadianSample[] = [{ ...initial, time: startEpochMs }];
  let state: CircadianState = { ...initial };
  let time = startEpochMs;
  for (let i = 1; i <= count; i++) {
    const nextTime = Math.min(endEpochMs, startEpochMs + i * stepMs);
    if (nextTime <= time) throw new RangeError('Simulation step is below epoch precision.');
    const lux = lightAt(time);
    if (!Number.isFinite(lux) || lux < 0 || lux > 100_000) throw new RangeError('Light must be between 0 and 100,000 lux.');
    state = step(state, lux, (nextTime - time) / HOUR);
    validateState(state);
    samples.push({ ...state, time: nextTime });
    time = nextTime;
  }
  return samples;
}

const entrainedStates = new Map<string, CircadianState>();
/**
 * Estimated baseline at UTC midnight after repeated habitual days. Assumes 150
 * lux throughout waking hours and darkness in sleep; these are scenario inputs,
 * not measured exposure or a fitted individual light response. 21 days is a
 * practical initialization period; it is not a proof of universal entrainment.
 */
export function entrainHabitual(wakeUtcHours: number, sleepHours: number, days = 21): CircadianState {
  if (![wakeUtcHours, sleepHours, days].every(Number.isFinite) || wakeUtcHours < 0 || wakeUtcHours >= 24
      || sleepHours < 4 || sleepHours > 12 || !Number.isInteger(days) || days < 1 || days > 90) {
    throw new RangeError('Habitual initialization needs wake hour 0–24, sleep 4–12 hours, and 1–90 whole days.');
  }
  const key = `${wakeUtcHours}:${sleepHours}:${days}`;
  const cached = entrainedStates.get(key);
  if (cached) return { ...cached };
  const samples = simulateForger(FORGER99_INITIAL_STATE, 0, days * DAY, (time) => {
    const sinceWake = modulo(time / HOUR - wakeUtcHours, 24);
    return sinceWake < 24 - sleepHours ? 150 : 0;
  });
  const last = samples[samples.length - 1];
  const result = { x: last.x, xc: last.xc, n: last.n };
  if (entrainedStates.size >= 64) entrainedStates.delete(entrainedStates.keys().next().value!);
  entrainedStates.set(key, result);
  return { ...result };
}

/** First genuine local minimum of modeled x at/after the epoch; endpoints do not establish a trough. */
export function estimateNadir(samples: readonly CircadianSample[], after: number): number | null {
  validateTime(after);
  if (samples.length > 100_001) throw new RangeError('Trajectory exceeds sample budget.');
  for (let i = 0; i < samples.length; i++) {
    validateState(samples[i]); validateTime(samples[i].time);
    if (i && samples[i].time <= samples[i - 1].time) throw new RangeError('Trajectory times must increase.');
  }
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1], b = samples[i], c = samples[i + 1];
    if (b.x <= a.x && b.x < c.x) {
      // Quadratic interpolation on unequal sample spacing, including short final step.
      const left = (b.time - a.time) / HOUR, right = (c.time - b.time) / HOUR;
      const slopeLeft = (b.x - a.x) / left, slopeRight = (c.x - b.x) / right;
      const curvature = (slopeRight - slopeLeft) / (left + right);
      const linear = slopeLeft + curvature * left;
      const shift = curvature > 0 ? Math.max(-left, Math.min(right, -linear / (2 * curvature))) : 0;
      const nadir = b.time + shift * HOUR;
      if (nadir >= after) return nadir;
    }
  }
  return null;
}
const rawPhaseHours = (state: CircadianState) => modulo(Math.atan2(-state.xc, state.x) * 12 / Math.PI, 24);
let baselineNadirPhase: number | undefined;
function calibratedNadirPhase(): number {
  if (baselineNadirPhase !== undefined) return baselineNadirPhase;
  const baseline = entrainHabitual(7, 8);
  const samples = simulateForger(baseline, 0, DAY, (time) => time / HOUR >= 7 && time / HOUR < 23 ? 150 : 0);
  const nadir = estimateNadir(samples, 0);
  if (nadir === null) throw new Error('Canonical baseline has no circadian nadir.');
  const i = Math.min(samples.length - 2, Math.floor(nadir / (5 * 60_000)));
  const a = samples[i], b = samples[i + 1], f = (nadir - a.time) / (b.time - a.time);
  baselineNadirPhase = rawPhaseHours({ x: a.x + f * (b.x - a.x), xc: a.xc + f * (b.xc - a.xc), n: a.n + f * (b.n - a.n) });
  return baselineNadirPhase;
}
/**
 * Angular proxy (hours elapsed since canonical x nadir, modulo 24), calibrated
 * against habitual wake07/sleep8 baseline. It is not a measured CBT/DLMO, a
 * prediction that habitual wake is precisely two hours after CBTmin, or a linear
 * clock: forcing and oscillator shape distort angular speed. Prefer x minima
 * from a trajectory when enough future samples are available.
 */
export function phaseHours(state: CircadianState): number {
  validateState(state);
  if (Math.hypot(state.x, state.xc) < 1e-8) throw new RangeError('Phase is undefined at zero oscillator amplitude.');
  return modulo(rawPhaseHours(state) - calibratedNadirPhase(), 24);
}
