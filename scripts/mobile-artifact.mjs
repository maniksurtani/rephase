import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertCheckedOutCommit, releaseContext } from './release-artifact.mjs';
import { isMainModule, projectRoot } from './check-deploy-config.mjs';

const files = ['NOTICE.txt', 'rephase-engine.js'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const mobileArtifactDirectory = resolve(projectRoot, 'artifacts/mobile');

export async function verifyMobileArtifact(context, directory = mobileArtifactDirectory) {
  const names = await readdir(directory);
  if (JSON.stringify(names.sort()) !== JSON.stringify([...files, 'manifest.json'].sort())) throw new Error('Unexpected mobile artifact files.');
  for (const name of names) {
    const stat = await lstat(resolve(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Mobile artifacts must contain ordinary files only.');
  }
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || Object.entries(context).some(([key, value]) => manifest[key] !== value)) {
    throw new Error('Mobile artifact does not match the verified commit and CI run attempt.');
  }
  for (const name of files) {
    if (digest(await readFile(resolve(directory, name))) !== manifest.files?.[name]) throw new Error('Mobile artifact checksum mismatch.');
  }
}

export async function createMobileArtifact(context, { directory = mobileArtifactDirectory, source = resolve(projectRoot, 'mobile/assets/engine') } = {}) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const hashes = {};
  for (const name of files) {
    await cp(resolve(source, name), resolve(directory, name));
    hashes[name] = digest(await readFile(resolve(directory, name)));
  }
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ version: 1, ...context, files: hashes }));
  await verifyMobileArtifact(context, directory);
}

if (isMainModule(import.meta.url)) {
  try {
    const context = releaseContext();
    assertCheckedOutCommit(context.sha);
    if (process.argv[2] === 'create') await createMobileArtifact(context);
    else if (process.argv[2] === 'install') {
      await verifyMobileArtifact(context);
      await mkdir(resolve(projectRoot, 'mobile/assets/engine'), { recursive: true });
      for (const name of files) await cp(resolve(mobileArtifactDirectory, name), resolve(projectRoot, 'mobile/assets/engine', name));
    } else throw new Error('Usage: node scripts/mobile-artifact.mjs create|install');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
