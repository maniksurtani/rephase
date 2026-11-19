import { appendFile } from 'node:fs/promises';
import { isMainModule } from './check-deploy-config.mjs';
import { githubRequest } from './select-release.mjs';

const workflows = { checks: 'ci.yml', mobile: 'mobile.yml', native: 'mobile-runtime.yml' };
const active = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export function trustedMobileRun(run, { sha, repository }, workflow) {
  return run.head_sha === sha && run.head_branch === 'main'
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && run.path === `.github/workflows/${workflow}`
    && ['push', 'workflow_dispatch', ...(workflow === workflows.native ? ['schedule'] : [])].includes(run.event);
}

/** Main-only release coordination. No signing keys or external service credentials. */
export function mobileCI({ sha, repository, request, wait, attempts = 180 }) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('Invalid mobile CI context.');
  }
  const api = `/repos/${repository}`;
  async function currentMain() {
    if ((await request(`${api}/git/ref/heads/main`)).object?.sha !== sha) {
      throw new Error('Main has advanced. Start a new release for current main.');
    }
  }
  async function find(workflow) {
    const { workflow_runs = [] } = await request(`${api}/actions/workflows/${workflow}/runs?branch=main&head_sha=${sha}&per_page=100`);
    return workflow_runs.filter((run) => trustedMobileRun(run, { sha, repository }, workflow))
      .sort((a, b) => b.id - a.id)[0];
  }
  async function ensure(workflow) {
    await currentMain();
    let run = await find(workflow);
    if (run) {
      if (workflow !== workflows.native && run.status === 'completed' && run.conclusion !== 'success') {
        throw new Error(`${workflow} has not passed. Review run ${run.id} before building a release.`);
      }
      return run;
    }
    // The reusable preparation job serializes dispatches across both platforms.
    await request(`${api}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST', body: JSON.stringify({ ref: 'main' }),
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      await wait(5_000);
      await currentMain();
      run = await find(workflow);
      if (run) return run;
    }
    throw new Error(`Dispatched ${workflow}, but its run has not appeared. Check Actions before retrying.`);
  }
  async function completed(id, workflow, platform) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new Error('Missing CI run ID.');
    for (let attempt = 0; attempt < attempts; attempt++) {
      await currentMain();
      const run = await request(`${api}/actions/runs/${id}`);
      if (!trustedMobileRun(run, { sha, repository }, workflow)) throw new Error('Untrusted mobile CI run.');
      if (platform) {
        const { jobs = [] } = await request(`${api}/actions/runs/${id}/jobs?filter=latest&per_page=100`);
        const job = jobs.find((value) => value.name === platform);
        if (job?.status === 'completed') {
          if (job.conclusion !== 'success') throw new Error(`${platform} runtime check failed or was skipped. Review run ${id}; publishing is blocked.`);
          return run;
        }
      } else if (run.status === 'completed' && run.conclusion === 'success') return run;
      if (!active.has(run.status)) throw new Error(`${workflow} has not passed. Review run ${id}; publishing is blocked.`);
      if (attempt < attempts - 1) await wait(10_000);
    }
    throw new Error(`Timed out waiting for ${workflow}. No upload was attempted.`);
  }
  return {
    async prepare() {
      // Start native validation before waiting for fast checks, so release builds
      // can overlap it. Existing runs are reused, never restarted after failure.
      const native = await ensure(workflows.native);
      const checks = await ensure(workflows.checks);
      const mobile = await ensure(workflows.mobile);
      const verified = await completed(mobile.id, workflows.mobile);
      const name = `verified-mobile-${sha}-${verified.run_attempt}`;
      const { artifacts = [] } = await request(`${api}/actions/runs/${mobile.id}/artifacts?per_page=100`);
      const artifact = artifacts.find((value) => value.name === name && !value.expired);
      if (!artifact) throw new Error('No verified mobile artifact. Re-run Mobile checks to recreate the 30-day artifact.');
      return { checks_run_id: String(checks.id), native_run_id: String(native.id),
        run_id: String(mobile.id), run_attempt: String(verified.run_attempt), artifact_id: String(artifact.id) };
    },
    async gate({ checksId, mobileId, nativeId, platform }) {
      if (!['android', 'ios'].includes(platform)) throw new Error('Choose android or ios.');
      await completed(checksId, workflows.checks);
      await completed(mobileId, workflows.mobile);
      await completed(nativeId, workflows.native, platform);
      await currentMain();
    },
  };
}

if (isMainModule(import.meta.url)) {
  try {
    const ci = mobileCI({ sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
      request: (path, options) => githubRequest(path, process.env, options),
      wait: (delay) => new Promise((resolve) => setTimeout(resolve, delay)) });
    if (process.argv[2] === 'prepare') {
      const outputs = await ci.prepare();
      await appendFile(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
      console.log('Reusing verified mobile assets; release compilation can overlap native checks.');
    } else if (process.argv[2] === 'gate') {
      await ci.gate({ checksId: process.env.CHECKS_RUN_ID, mobileId: process.env.MOBILE_RUN_ID,
        nativeId: process.env.NATIVE_RUN_ID, platform: process.argv[3] });
      console.log('Required CI passed for this exact main commit; upload is permitted.');
    } else throw new Error('Usage: node scripts/mobile-ci.mjs prepare|gate android|ios');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
