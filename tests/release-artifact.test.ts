import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Plain Node entry points intentionally have no declarations.
import { releaseContext, useReleaseConfig, verifyRelease } from '../scripts/release-artifact.mjs';

const context = { sha: 'a'.repeat(40), repository: 'owner/rephase', runId: '123', runAttempt: '2' };
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'rephase-release-'));
  temporary.push(root);
  const directory = join(root, 'release');
  const contents: Record<string, string> = {
    'dist/index.html': '<html>Tested application</html>',
    'dist/assets/app.js': 'application()',
    'worker/index.js': 'export default {}',
    'worker/module.wasm': 'worker module',
    'migrations/0001_initial.sql': 'CREATE TABLE example(id INTEGER);',
    'wrangler.jsonc': '{"main":"worker/index.ts","assets":{"directory":"dist"}}',
  };
  for (const [path, content] of Object.entries(contents)) {
    await mkdir(join(directory, path, '..'), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  await writeFile(join(root, 'wrangler.jsonc'), contents['wrangler.jsonc']);
  const manifest = { version: 1, ...context, files: Object.fromEntries(Object.entries(contents)
    .map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')])) };
  const saveManifest = () => writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await saveManifest();
  return { directory, sourceRoot: root, manifest, saveManifest };
}

describe('verified release artifact', () => {
  it('verifies the exact SHA, run and attempt with every static asset, Worker module and migration', async () => {
    const fixture = await releaseFixture();
    await expect(verifyRelease(context, fixture)).resolves.toEqual(fixture.manifest);
  });

  it.each(['sha', 'repository', 'runId', 'runAttempt'] as const)('rejects mismatched %s provenance', async (key) => {
    const fixture = await releaseFixture();
    await expect(verifyRelease({ ...context, [key]: 'different' }, fixture)).rejects.toThrow('provenance');
  });

  it.each(['dist/assets/app.js', 'worker/module.wasm', 'migrations/0001_initial.sql'])('rejects modified release file %s', async (path) => {
    const fixture = await releaseFixture();
    await writeFile(join(fixture.directory, path), 'changed after checks');
    await expect(verifyRelease(context, fixture)).rejects.toThrow('verified inventory');
  });

  it('rejects unlisted files and missing required entry points', async () => {
    const fixture = await releaseFixture();
    await writeFile(join(fixture.directory, 'worker/unlisted.js'), 'extra');
    await expect(verifyRelease(context, fixture)).rejects.toThrow('verified inventory');
    delete fixture.manifest.files['worker/index.js'];
    await fixture.saveManifest();
    await expect(verifyRelease(context, fixture)).rejects.toThrow('missing');
  });

  it.each(['../outside', '/absolute', 'worker/../outside', 'worker\\outside', 'node_modules/script.js'])('rejects unsafe inventory path %s', async (path) => {
    const fixture = await releaseFixture();
    fixture.manifest.files[path] = 'a'.repeat(64);
    await fixture.saveManifest();
    await expect(verifyRelease(context, fixture)).rejects.toThrow('inventory is invalid');
  });

  it('rejects symlinks even when their destination matches a manifest hash', async () => {
    const fixture = await releaseFixture();
    const target = join(fixture.directory, 'worker/module.wasm');
    await rm(target);
    await symlink(join(fixture.directory, 'worker/index.js'), target);
    await expect(verifyRelease(context, fixture)).rejects.toThrow('ordinary files');
  });

  it('rejects a changed checked-out configuration and deployment-time build hooks', async () => {
    const fixture = await releaseFixture();
    await writeFile(join(fixture.sourceRoot, 'wrangler.jsonc'), '{}');
    await expect(verifyRelease(context, fixture)).rejects.toThrow('configuration differs');
    const config = '{"build":{"command":"npm run build"}}';
    await writeFile(join(fixture.sourceRoot, 'wrangler.jsonc'), config);
    await writeFile(join(fixture.directory, 'wrangler.jsonc'), config);
    fixture.manifest.files['wrangler.jsonc'] = createHash('sha256').update(config).digest('hex');
    await fixture.saveManifest();
    await expect(verifyRelease(context, fixture)).rejects.toThrow('deployment-time build');
  });

  it('pins all deployable paths to the verified bundle while preserving runtime configuration', () => {
    const config = { main: 'worker/index.ts', vars: { GOOGLE_CLIENT_ID: 'public-client' }, assets: { directory: 'dist', binding: 'ASSETS' },
      d1_databases: [{ binding: 'DB', database_id: 'configured-id', migrations_dir: 'migrations' }], triggers: { crons: ['0 * * * *'] } };
    expect(useReleaseConfig(config)).toEqual({ ...config, main: 'artifacts/release/worker/index.js', no_bundle: true,
      assets: { ...config.assets, directory: 'artifacts/release/dist' },
      d1_databases: [{ ...config.d1_databases[0], migrations_dir: 'artifacts/release/migrations' }] });
  });

  it('requires complete release identity and uses the selected Checks run rather than Deploy run identity', () => {
    expect(releaseContext({ RELEASE_SHA: context.sha, GITHUB_REPOSITORY: context.repository,
      RELEASE_RUN_ID: '123', RELEASE_RUN_ATTEMPT: '2', GITHUB_RUN_ID: '999', GITHUB_RUN_ATTEMPT: '1' })).toEqual(context);
    expect(() => releaseContext({ GITHUB_SHA: context.sha })).toThrow('exact commit');
  });

});
