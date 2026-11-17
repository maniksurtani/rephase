import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function loungeAssets() {
  const schema = JSON.parse(await readFile(resolve(root, 'data/lounges/schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true, code: { source: true, esm: true } });
  const validate = ajv.compile(schema);
  const files = new Map();
  const airports = [];
  const names = (await readdir(resolve(root, 'data/lounges'))).filter(n => /^[A-Z]{3}\.json$/.test(n)).sort();
  for (const name of names) {
    const data = JSON.parse(await readFile(resolve(root, 'data/lounges', name), 'utf8'));
    if (!validate(data)) throw new Error(`${name}: ${JSON.stringify(validate.errors)}`);
    const content = JSON.stringify(data);
    const version = createHash('sha256').update(content).digest('hex');
    const path = `/lounge-data/v1/airports/${data.airport}.${version}.json`;
    files.set(path, content);
    airports.push({ airport: data.airport, timeZone: data.timeZone, updatedAt: data.updatedAt, version, path });
  }
  const catalog = { schemaVersion: 1, airports };
  files.set('/lounge-data/v1/manifest.json', JSON.stringify(catalog));
  // Compile the JSON Schema at build time. No eval/new Function in browser/WebView.
  const output = await build({ stdin: { contents: standaloneCode(ajv, validate), resolveDir: root, sourcefile: 'lounge-validator.js' }, bundle: true, write: false, platform: 'browser', format: 'esm', minify: true });
  return { catalog, files, validator: output.outputFiles[0].text };
}

export function loungeAssetsPlugin() {
  let pending;
  const get = () => pending ??= loungeAssets();
  return {
    name: 'rephase-lounge-assets',
    resolveId(id) { if (id === 'virtual:lounge-catalog' || id === 'virtual:lounge-validator') return `\0${id}`; },
    async load(id) {
      if (id === '\0virtual:lounge-catalog') return `export default ${JSON.stringify((await get()).catalog)};`;
      if (id === '\0virtual:lounge-validator') return (await get()).validator;
    },
    async generateBundle() {
      for (const [path, source] of (await get()).files) this.emitFile({ type: 'asset', fileName: path.slice(1), source });
      this.emitFile({ type: 'asset', fileName: '_headers', source: '/lounge-data/v1/manifest.json\n  Cache-Control: public, max-age=0, must-revalidate\n/lounge-data/v1/airports/*\n  Cache-Control: public, max-age=31536000, immutable\n' });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/lounge-data/')) return next();
        try {
          const content = (await get()).files.get(req.url.split('?')[0]);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.statusCode = content ? 200 : 404;
          res.end(content ?? '{"error":"Guide unavailable"}');
        } catch (error) { next(error); }
      });
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(resolve(root, 'data/lounges'))) {
        pending = undefined;
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
