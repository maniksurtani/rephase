#!/usr/bin/env python3
"""Generate frozen Forger99 trajectories using the actual pinned reference.

Needs Python numpy/scipy/fastcore/pandas/matplotlib (in a temporary venv if desired).
  python scripts/verify-circadian-reference.py --reference /path/to/circadian
  python scripts/verify-circadian-reference.py --reference /path/to/circadian --check
Clone reference: git clone https://github.com/Arcascope/circadian.git /tmp/circadian
then: git -C /tmp/circadian checkout db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a

The derivatives are imported, never rewritten in this script. Independent SciPy
DOP853 solves piecewise-constant light segments with tight adaptive tolerances;
reference.step_rk4 supplies fixed-step trajectories for equation-port comparison.
No TypeScript execution is used to generate any expected state.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

COMMIT = 'db6eb08b6c0b0586cdac7795bf10bbbbfd323c1a'
PARAMS = dict(taux=24.2, mu=0.23, G=33.75, alpha_0=0.05, beta=0.0075,
              p=0.5, I0=9500.0, k=0.55, cbt_to_dlmo=7.0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'tests/fixtures/circadian/forger99.json')
    parser.add_argument('--check', action='store_true', help='Compare regenerated states with the checked-in fixture')
    args = parser.parse_args()
    reference = args.reference.resolve()
    actual = subprocess.check_output(['git', '-C', str(reference), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != COMMIT:
        raise RuntimeError(f'Reference must be {COMMIT}; got {actual}')
    if subprocess.check_output(['git', '-C', str(reference), 'status', '--porcelain', '--untracked-files=no'], text=True).strip():
        raise RuntimeError('Reference tracked files have local modifications')
    sys.path.insert(0, str(reference))
    import numpy as np
    import scipy
    from scipy.integrate import solve_ivp
    from scipy.optimize import brentq
    from circadian.models import Forger99

    model = Forger99()
    if model.parameters != PARAMS:
        raise RuntimeError(f'Reference default parameters changed: {model.parameters}')
    initial = model._default_initial_condition.copy()

    # All transitions are on quarter-hour boundaries, and therefore align with
    # every compared timestep. Hours are elapsed UTC hours, independent of DST.
    def habitual(hours):
        segments = []
        for day in range(hours // 24):
            for start, end, lux in [(0, 7, 0), (7, 23, 150), (23, 24, 0)]:
                segments.append([24 * day + start, 24 * day + end, lux])
        return segments

    def variable():
        segments = []
        for day in range(12):
            # A constructed shifting exposure scenario, not an optimized plan.
            shift = [0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2][day]
            windows = [(0, 6 - shift, 0), (6 - shift, 8 - shift, 75),
                       (8 - shift, 9.5 - shift, 2500), (9.5 - shift, 17 - shift, 150),
                       (17 - shift, 19 - shift, 30 if day in [3, 4, 8] else 600),
                       (19 - shift, 22 - shift, 50), (22 - shift, 24, 0)]
            for start, end, lux in windows:
                segments.append([24 * day + start, 24 * day + end, lux])
        return segments

    cases = [('constant_darkness_8_days', [[0, 8 * 24, 0]]),
             ('habitual_28_days', habitual(28 * 24)),
             ('variable_lux_12_days', variable()),
             ('high_lux_pulses_4_days', [[24 * d + s, 24 * d + e, lux]
                 for d in range(4) for s, e, lux in [(0, 7, 0), (7, 8, 10_000), (8, 22, 150), (22, 24, 0)]])]
    fixture_cases = []
    for name, segments in cases:
        duration = segments[-1][1]
        sample_times = np.arange(0, duration + 0.5, 0.5)
        # Integrate each light interval separately so discontinuities cannot be
        # skipped by an adaptive solver. Dense evaluation never crosses them.
        adaptive = np.empty((len(sample_times), 3))
        adaptive[0] = initial
        state = initial.copy()
        nadirs = []
        previous_lux = segments[0][2]
        for begin, end, lux in segments:
            if begin > 0 and model.derv(begin, state, previous_lux)[0] < 0 < model.derv(begin, state, lux)[0]:
                nadirs.append(float(begin))
            sol = solve_ivp(lambda t, y: model.derv(t, y, lux), (begin, end), state,
                            method='DOP853', rtol=1e-12, atol=1e-13, dense_output=True, max_step=0.1)
            if not sol.success:
                raise RuntimeError(sol.message)
            indices = np.flatnonzero((sample_times > begin) & (sample_times <= end))
            adaptive[indices] = sol.sol(sample_times[indices]).T
            root_grid = np.linspace(begin, end, int(np.ceil((end - begin) / 0.05)) + 1)
            slopes = [model.derv(t, sol.sol(t), lux)[0] for t in root_grid]
            for i in range(len(root_grid) - 1):
                if slopes[i] < 0 <= slopes[i + 1]:
                    root = brentq(lambda t: model.derv(t, sol.sol(t), lux)[0], root_grid[i], root_grid[i + 1], xtol=1e-12)
                    if not nadirs or root - nadirs[-1] > 1e-6:
                        nadirs.append(float(root))
            state = sol.y[:, -1]
            previous_lux = lux

        # Reference RK4 uses one constant lux input for all four stages. Use
        # left-endpoint light assignment explicitly, as in the TS API contract.
        convergence = {}
        rk5 = None
        for minutes in [15, 5, 2.5, 1]:
            step_hours = minutes / 60
            state = initial.copy()
            rk = [state.copy()]
            segment_index = 0
            count = round(duration / step_hours)
            for index in range(count):
                t = index * step_hours
                while t >= segments[segment_index][1] - 1e-10 and segment_index < len(segments) - 1:
                    segment_index += 1
                state = model.step_rk4(t, state, segments[segment_index][2], step_hours)
                if (index + 1) % round(0.5 / step_hours) == 0:
                    rk.append(state.copy())
            rk = np.array(rk)
            error = np.abs(rk - adaptive)
            convergence[str(minutes)] = {'maxAbsStateError': float(error.max()),
                                         'componentMaxAbsError': error.max(axis=0).tolist(),
                                         'endAbsError': error[-1].tolist()}
            if minutes == 5:
                rk5 = rk
        fixture_cases.append(dict(name=name, initial=initial.tolist(), durationHours=duration,
                                  lightSegments=segments, timeHours=sample_times.tolist(),
                                  scipyStates=adaptive.tolist(), scipyNadirHours=nadirs, referenceRk4FiveMinuteStates=rk5.tolist(),
                                  convergence=convergence))
        print(name, json.dumps(convergence, separators=(',', ':')))

    metadata = dict(repository='https://github.com/Arcascope/circadian', commit=COMMIT,
                    referenceVersion='1.0.3', sourceFile='circadian/models.py',
                    sourceSha256=hashlib.sha256((reference / 'circadian/models.py').read_bytes()).hexdigest(),
                    licenseSha256=hashlib.sha256((reference / 'LICENSE').read_bytes()).hexdigest(),
                    license='MIT (repository LICENSE)', model='Forger99', parameters=PARAMS,
                    scipyVersion=scipy.__version__, numpyVersion=np.__version__,
                    independentSolver='scipy.integrate.solve_ivp/DOP853', rtol=1e-12, atol=1e-13,
                    maxAdaptiveStepHours=0.1, inputConvention='piecewise constant, interval left endpoint',
                    sampleIntervalHours=0.5, generatedBy='scripts/verify-circadian-reference.py',
                    clinicalValidation=False)
    result = dict(metadata=metadata, cases=fixture_cases)
    if args.check:
        frozen = json.loads(args.output.read_text())
        if frozen['metadata']['commit'] != COMMIT or frozen['metadata']['sourceSha256'] != metadata['sourceSha256']:
            raise RuntimeError('Frozen fixture reference identity differs')
        for actual_case, expected_case in zip(fixture_cases, frozen['cases'], strict=True):
            if actual_case['name'] != expected_case['name'] or actual_case['lightSegments'] != expected_case['lightSegments']:
                raise RuntimeError('Frozen fixture scenarios differ')
            for key in ['scipyStates', 'referenceRk4FiveMinuteStates', 'scipyNadirHours']:
                error = np.abs(np.asarray(actual_case[key]) - np.asarray(expected_case[key])).max()
                if error > 1e-10:
                    raise RuntimeError(f"Fixture difference {actual_case['name']}/{key}: {error}")
        print('Frozen fixture independently reproduced within 1e-10.')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
        print(f'Wrote {args.output}')


if __name__ == '__main__':
    main()
