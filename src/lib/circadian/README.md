# Forger99 numerical kernel

This is a TypeScript port of Forger99 in the MIT-licensed Arcascope `circadian`
reference at commit `db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a` (version 1.0.3).
Parameters and derivatives are unchanged. Time is hours inside the equations;
public simulation timestamps are UTC epoch milliseconds. States `x`, `xc`, and
`n` are model quantities, not body temperature measurements. See
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md) for attribution.

`simulateForger(initial, startMs, endMs, lightAt, stepMinutes=5)` uses classical
fixed-step RK4, with lux sampled at the **left endpoint** and held constant for
all four stages. Light transitions should align with integration steps; a
transition within a step is represented at the following step boundary. This
explicit input convention differs from the upstream `integrate` helper's
right-endpoint array assignment, but matches its `step_rk4` implementation when
passed the same interval input. There are no phase-rate overrides, simulated
melatonin terms, or post-step state clipping.

`entrainHabitual(wakeUtcHours, sleepHours, days=21)` returns an estimated midnight
state after repeated days of 150-lux waking exposure and zero-lux sleep. It is a
scenario assumption, with population defaults and no individualized parameter
fitting. The 21-day initialization does not establish biological entrainment
for every schedule or person. `phaseHours(state)` returns a nonlinear angular
proxy in [0,24), with zero calibrated to the actual modeled `x` minimum in the
canonical wake07/sleep8 baseline. It does **not** force CBTmin to habitual wake
minus two hours. `estimateNadir(samples, afterMs)` finds the earliest sampled
local `x` minimum, with quadratic interpolation; light discontinuities can
produce cusp minima, so precision is limited by the simulation timestep.
Endpoints alone cannot establish a minimum. No individual DLMO measurement is
inferred. Unlike the reference's convenience peak finder, this function does
not impose a 13-hour separation or discard close local minima.

Validation bounds cover finite state with |x|/|xc| ≤4, n approximately [0,1],
0–100,000 lux, 0.25–15 minute timesteps, at most 180 days and 100,000 steps per
call. These bounds prevent runaway computation; they do not establish model
accuracy throughout that domain. Coarse 15-minute candidate trajectories are
less precise, especially at high lux. Use the default five-minute replay for
the selected schedule. This is a low-dimensional population model with no
representation of actual eye exposure, individual photic sensitivity,
medications, adherence physiology, sleep homeostasis or seat-related sleep
quality.

## Independent numerical verification

The frozen fixture `tests/fixtures/circadian/forger99.json` comes from actual
upstream Python derivatives, solved independently by SciPy DOP853 with
rtol=1e-12, atol=1e-13 and max adaptive step 0.1 hours. Every discontinuity is a
separate integration interval. Independent troughs come from dense-output
roots of `dx/dt`, plus true sign-changing light-transition cusps. No TypeScript
is executed to generate expected data. The fixture records source/license
SHA256 hashes, commit, versions, parameters and input schedule.

| Exposure scenario | Duration | Max state difference, 15 min RK4 vs SciPy | 5 min | 2.5 min |
| --- | --- | ---: | ---: | ---: |
| Darkness | 8 days | 6.94e-6 | 8.61e-8 | 5.39e-9 |
| Habitual wake07, sleep8, 150 lux | 28 days | 3.20e-6 | 3.99e-8 | 2.50e-9 |
| Shifting 0–2,500 lux, including cabin light | 12 days | 1.40e-4 | 1.30e-6 | 7.61e-8 |
| Daily 10,000-lux pulses | 4 days | 2.78e-3 | 2.08e-5 | 1.15e-6 |

Errors are absolute differences in dimensionless model state, **not hours of
real-world jet lag**. The TypeScript five-minute trajectories match upstream
Python RK4 to within 5e-12. Timestep refinement shows convergence; sampled
trough estimates are checked against independent adaptive minima within one
five-minute step. Those checks establish equation and numerical agreement for
the included scenarios, **not clinical validation of Rephase**, individualized
prediction accuracy, or the quality of the planner's optimization objective.

Reproduce without changing app dependencies:

```sh
git clone https://github.com/Arcascope/circadian.git /tmp/circadian-reference
git -C /tmp/circadian-reference checkout db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a
python3 -m venv /tmp/circadian-verify
/tmp/circadian-verify/bin/pip install numpy scipy fastcore pandas matplotlib
/tmp/circadian-verify/bin/python scripts/verify-circadian-reference.py \
  --reference /tmp/circadian-reference --check
npm test -- tests/circadian.test.ts
```

Omit `--check` to regenerate frozen fixtures. Their generator refuses a wrong
reference commit or modified tracked source. Subsequent clinical validation,
external schedule optimization review, sensitivity studies and real traveler
outcomes remain separate work.
