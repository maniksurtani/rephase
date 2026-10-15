import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Plain Node entry points intentionally have no declarations.
import { selectRelease, trustedChecksRun } from '../scripts/select-release.mjs';

const sha = 'a'.repeat(40);
const repository = 'owner/rephase';
const run = { id: 123, run_attempt: 2, head_sha: sha, head_branch: 'main', head_repository: { full_name: repository },
  repository: { full_name: repository }, path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success' };
const artifact = { id: 789, name: `verified-release-${sha}-2`, expired: false };

function apiFixture(runs = [run], artifacts = [artifact], currentMain = sha) {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: currentMain } };
    if (path.includes('/artifacts?')) return { artifacts };
    if (path.endsWith('/actions/runs/123')) return runs[0];
    if (path.includes('/actions/workflows/ci.yml/runs?')) return { workflow_runs: runs };
    throw new Error(`Unexpected mock path ${path}`);
  });
  return { sha, repository, request, wait: vi.fn().mockResolvedValue(undefined), attempts: 2 };
}

describe('exact-commit release selection', () => {
  it('selects only the successful run attempt artifact and returns its immutable ID', async () => {
    await expect(selectRelease(apiFixture())).resolves.toEqual({ sha, run_id: '123', run_attempt: '2', artifact_name: artifact.name, artifact_id: '789' });
  });

  it.each([
    { event: 'pull_request' }, { head_branch: 'feature' }, { head_sha: 'b'.repeat(40) },
    { path: '.github/workflows/untrusted.yml' }, { head_repository: { full_name: 'fork/rephase' } },
    { repository: { full_name: 'other/rephase' } },
  ])('rejects an untrusted run: %s', async (change) => {
    expect(trustedChecksRun({ ...run, ...change }, { sha, repository })).toBe(false);
    await expect(selectRelease(apiFixture([{ ...run, ...change }]))).rejects.toThrow('No successful trusted');
  });

  it('rejects failed checks and missing or expired artifacts with recovery instructions', async () => {
    await expect(selectRelease(apiFixture([{ ...run, conclusion: 'failure' }]))).rejects.toThrow('Run the Checks workflow');
    await expect(selectRelease(apiFixture([run], []))).rejects.toThrow('no usable release artifact');
    await expect(selectRelease(apiFixture([run], [{ ...artifact, expired: true }]))).rejects.toThrow('30 days');
    await expect(selectRelease(apiFixture([run], [{ ...artifact, name: `verified-release-${sha}-1` }]))).rejects.toThrow('no usable release artifact');
  });

  it('waits for existing checks instead of launching a duplicate verification', async () => {
    const fixture = apiFixture([{ ...run, status: 'in_progress', conclusion: '' }]);
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/git/ref/heads/main')) return { object: { sha } };
      if (path.includes('/artifacts?')) return { artifacts: [artifact] };
      return { workflow_runs: [fixture.wait.mock.calls.length ? run : { ...run, status: 'in_progress', conclusion: '' }] };
    });
    await expect(selectRelease(fixture)).resolves.toMatchObject({ run_id: '123' });
    expect(fixture.wait).toHaveBeenCalledExactlyOnceWith(10_000);
  });

  it('fails finitely while checks remain in progress', async () => {
    const fixture = apiFixture([{ ...run, status: 'in_progress', conclusion: '' }]);
    await expect(selectRelease(fixture)).rejects.toThrow('Timed out');
    expect(fixture.wait).toHaveBeenCalledTimes(1);
  });

  it('pins automatic deployment to its triggering run rather than selecting another result', async () => {
    const fixture = apiFixture();
    await expect(selectRelease({ ...fixture, triggeringRunId: '123' })).resolves.toMatchObject({ run_id: '123' });
    expect(fixture.request.mock.calls.some(([path]) => path.includes('/actions/workflows/'))).toBe(false);
  });

  it('refuses a stale deployment when main has advanced', async () => {
    const fixture = apiFixture([run], [artifact], 'b'.repeat(40));
    await expect(selectRelease(fixture)).rejects.toThrow('Main has advanced');
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
});
