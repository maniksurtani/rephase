import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const engineOutput = resolve(root, 'mobile/assets/engine/rephase-engine.js');

/** Bundle the production planner and curated data without Vite or a remote runtime. */
export async function buildMobileEngine(outfile = engineOutput) {
  await mkdir(dirname(outfile), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/mobile/bridge.ts'],
    outfile,
    bundle: true,
    format: 'iife',
    globalName: 'RephaseMobile',
    platform: 'browser',
    target: ['chrome100', 'safari15.4'],
    minify: true,
    legalComments: 'inline',
    plugins: [
      {
        name: 'mobile-curated-lounges',
        setup(plugin) {
          plugin.onLoad({ filter: /[/\\]lib[/\\]lounge-data\.ts$/ }, async ({ path }) => {
            const directory = resolve(root, 'data/lounges');
            const names = (await readdir(directory))
              .filter((name) => /^[A-Z]{3}\.json$/.test(name))
              .sort();
            const records = {};
            for (const name of names)
              records[name] = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
            const source = await readFile(path, 'utf8');
            const contents = source.replace(
              /const records = import\.meta\.glob\([\s\S]*?\n\}\);/,
              `const records = ${JSON.stringify(records)};`,
            );
            if (contents === source)
              throw new Error('The lounge data loader changed; update the mobile bundler.');
            return { contents, loader: 'ts', resolveDir: dirname(path) };
          });
        },
      },
    ],
  });
  const notices = await Promise.all(
    [
      ['airportsdata', 'public/data-licenses/airportsdata-LICENSE.txt'],
      ['Forger99 reference: Arcascope circadian', 'public/data-licenses/circadian-MIT.txt'],
      ['@js-temporal/polyfill', 'node_modules/@js-temporal/polyfill/LICENSE'],
      ['JSBI (https://github.com/GoogleChromeLabs/jsbi)', 'node_modules/jsbi/LICENSE'],
    ].map(
      async ([name, path]) =>
        `## ${name}\n\n${(await readFile(resolve(root, path), 'utf8')).trim()}`,
    ),
  );
  const thirdParty = await readFile(
    resolve(root, 'public/data-licenses/third-party-notices.txt'),
    'utf8',
  );
  const solar = thirdParty.indexOf('## Solar calculations');
  if (solar < 0)
    throw new Error('The solar calculation notice changed; update the mobile notices.');
  notices.push(thirdParty.slice(solar).trim());
  await writeFile(
    resolve(dirname(outfile), 'NOTICE.txt'),
    `Rephase mobile offline engine: third-party licenses and notices\n\n${notices.join('\n\n')}\n`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMobileEngine();
  console.log('Built mobile/assets/engine/rephase-engine.js from the shared TypeScript planner.');
}
