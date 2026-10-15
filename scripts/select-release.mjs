import { appendFile } from 'node:fs/promises';
import { isMainModule } from './check-deploy-config.mjs';

export const checksWorkflow = '.github/workflows/ci.yml';

export function trustedChecksRun(run, { sha, repository }) {
  return run.head_sha === sha && run.head_branch === 'main'
    && run.head_repository?.full_name === repository
    && run.repository?.full_name === repository
    && run.path === checksWorkflow
    && ['push', 'workflow_dispatch'].includes(run.event);
}

export async function selectRelease({ sha, repository, triggeringRunId, request, wait, attempts = 100 }) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')
      || (triggeringRunId && !/^[1-9]\d*$/.test(triggeringRunId))) throw new Error('Invalid release selection context.');
  const api = `/repos/${repository}`;
  const guidance = 'Run the Checks workflow on the current main commit, wait for success, then retry deployment. Artifacts are retained for 30 days.';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const branch = await request(`${api}/git/ref/heads/main`);
    if (branch.object?.sha !== sha) throw new Error('Main has advanced; refusing to deploy an older commit. Run deployment again for current main.');
    const candidates = triggeringRunId ? [await request(`${api}/actions/runs/${triggeringRunId}`)]
      : (await request(`${api}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=100`)).workflow_runs;
    const runs = (candidates || []).filter((run) => trustedChecksRun(run, { sha, repository }));
    const successful = runs.find((run) => run.status === 'completed' && run.conclusion === 'success');
    if (successful) {
      const artifactName = `verified-release-${sha}-${successful.run_attempt}`;
      // A single Checks run uploads one release plus an optional browser report.
      const { artifacts = [] } = await request(`${api}/actions/runs/${successful.id}/artifacts?per_page=100`);
      const artifact = artifacts.find((entry) => entry.name === artifactName && !entry.expired);
      if (!artifact) throw new Error(`The successful Checks run has no usable release artifact. ${guidance}`);
      return { sha, run_id: String(successful.id), run_attempt: String(successful.run_attempt), artifact_name: artifactName, artifact_id: String(artifact.id) };
    }
    if (!runs.some((run) => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status))) {
      throw new Error(`No successful trusted Checks run exists for this exact main commit. ${guidance}`);
    }
    if (attempt === 0) console.log('Waiting for the existing Checks run; deployment will not rerun browser tests.');
    if (attempt < attempts - 1) await wait(10_000);
  }
  throw new Error(`Timed out waiting for Checks. ${guidance}`);
}

export async function githubRequest(path, env = process.env) {
  if (!env.GITHUB_TOKEN) throw new Error('Release selection requires the workflow token with actions:read and contents:read.');
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub could not verify release provenance (HTTP ${response.status}).`);
  return response.json();
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await selectRelease({
      sha: process.env.RELEASE_SHA, repository: process.env.GITHUB_REPOSITORY,
      triggeringRunId: process.env.RELEASE_TRIGGER_RUN_ID || undefined,
      request: githubRequest, wait: (delay) => new Promise((done) => setTimeout(done, delay)),
    });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(`Reusing Checks run ${result.run_id}, attempt ${result.run_attempt}, for ${result.sha}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
