import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Plain Node release tooling.
import { mobileCI, trustedMobileRun } from '../scripts/mobile-ci.mjs';
// @ts-expect-error Plain Node release tooling.
import { createMobileArtifact, verifyMobileArtifact } from '../scripts/mobile-artifact.mjs';

const sha = 'a'.repeat(40);
const repository = 'owner/rephase';
function run(id: number, workflow: string) {
  return { id, run_attempt: 2, head_sha: sha, head_branch: 'main',
    repository: { full_name: repository }, head_repository: { full_name: repository },
    path: `.github/workflows/${workflow}`, event: 'push', status: 'completed', conclusion: 'success' };
}
function fixture() {
  const runs = [run(1, 'ci.yml'), run(2, 'mobile.yml'), run(3, 'mobile-runtime.yml')];
  const request = vi.fn(async (path: string, options?: { method: string }) => {
    if (options) throw new Error('Unexpected mutation');
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha } };
    if (path.includes('/artifacts?')) return { artifacts: [{ id: 7, name: `verified-mobile-${sha}-2`, expired: false }] };
    if (path.includes('/jobs?')) return { jobs: [{ name: 'ios', status: 'completed', conclusion: 'success' }] };
    if (path.includes('/workflows/')) return { workflow_runs: runs.filter((r) => path.includes(r.path.split('/').at(-1)!)) };
    return runs.find((r) => path.endsWith(`/runs/${r.id}`));
  });
  const wait = vi.fn(async () => {});
  const options = { sha, repository, request, wait, attempts: 2 };
  return { runs, request, wait, options, ci: mobileCI(options) };
}
const gate = { checksId: 1, mobileId: 2, nativeId: 3, platform: 'ios' };

describe('mobile release coordination', () => {
  it('reuses existing CI and the successful attempt artifact without rebuilding or redispatching', async () => {
    const f = fixture();
    await expect(f.ci.prepare()).resolves.toEqual({ checks_run_id: '1', native_run_id: '3', run_id: '2', run_attempt: '2', artifact_id: '7' });
    await expect(f.ci.gate(gate)).resolves.toBeUndefined();
    expect(f.wait).not.toHaveBeenCalled();
    expect(f.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
  it('starts missing native CI while allowing compilation after fast checks', async () => {
    const f = fixture();
    const original = f.request.getMockImplementation()!;
    let dispatched = false;
    f.request.mockImplementation(async (path, options) => {
      if (path.endsWith('/mobile-runtime.yml/dispatches')) { dispatched = true; return null as any; }
      if (path.includes('/workflows/mobile-runtime.yml/runs?')) return { workflow_runs: dispatched ? [{ ...f.runs[2], status: 'queued', conclusion: '' }] : [] } as any;
      return original(path, options);
    });
    await expect(f.ci.prepare()).resolves.toMatchObject({ native_run_id: '3' });
    expect(f.request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it.each([0, 1])('blocks publishing after required checks fail (%i)', async (index) => {
    const f = fixture(); f.runs[index].conclusion = 'failure';
    await expect(f.ci.gate(gate)).rejects.toThrow('has not passed');
  });
  it('blocks failed or skipped native checks but does not require the other platform', async () => {
    for (const conclusion of ['failure', 'skipped']) {
      const f = fixture(); const original = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (path, options) => path.includes('/jobs?')
        ? { jobs: [{ name: 'ios', status: 'completed', conclusion }] } as any : original(path, options));
      await expect(f.ci.gate(gate)).rejects.toThrow('runtime check failed or was skipped');
    }
    const f = fixture(); f.runs[2].conclusion = 'failure';
    await expect(f.ci.gate(gate)).resolves.toBeUndefined();
  });
  it('waits for native completion and fails with a bounded deadline', async () => {
    const f = fixture(); f.runs[2].status = 'in_progress';
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, options) => path.includes('/jobs?') ? { jobs: [] } as any : original(path, options));
    await expect(f.ci.gate(gate)).rejects.toThrow('Timed out');
    expect(f.wait).toHaveBeenCalledExactlyOnceWith(10_000);
  });
  it.each([{ event: 'pull_request' }, { head_sha: 'b'.repeat(40) }, { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/rephase' } }, { path: '.github/workflows/other.yml' }])('rejects untrusted CI: %s', (change) => {
    expect(trustedMobileRun({ ...run(1, 'mobile.yml'), ...change }, { sha, repository }, 'mobile.yml')).toBe(false);
  });
  it('rejects expired artifacts and refuses releases when main advances', async () => {
    const f = fixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, options) => path.includes('/artifacts?') ? { artifacts: [] } as any : original(path, options));
    await expect(f.ci.prepare()).rejects.toThrow('Re-run Mobile checks');
    f.request.mockImplementation(async () => ({ object: { sha: 'b'.repeat(40) } }) as any);
    await expect(f.ci.gate(gate)).rejects.toThrow('Main has advanced');
  });
});

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('mobile artifacts reject stale provenance, tampering and unexpected files', async () => {
  const source = await mkdtemp(join(tmpdir(), 'mobile-source-'));
  const directory = await mkdtemp(join(tmpdir(), 'mobile-artifact-'));
  directories.push(source, directory);
  await writeFile(join(source, 'rephase-engine.js'), 'verified engine');
  await writeFile(join(source, 'NOTICE.txt'), 'licenses');
  const context = { sha, repository, runId: '2', runAttempt: '2' };
  await createMobileArtifact(context, { source, directory });
  await expect(verifyMobileArtifact(context, directory)).resolves.toBeUndefined();
  await expect(verifyMobileArtifact({ ...context, runAttempt: '1' }, directory)).rejects.toThrow('does not match');
  const engine = await readFile(join(directory, 'rephase-engine.js'));
  await writeFile(join(directory, 'rephase-engine.js'), 'changed');
  await expect(verifyMobileArtifact(context, directory)).rejects.toThrow('checksum');
  await writeFile(join(directory, 'rephase-engine.js'), engine);
  await writeFile(join(directory, 'secret.json'), 'unexpected');
  await expect(verifyMobileArtifact(context, directory)).rejects.toThrow('Unexpected');
});
