#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/benchmark-bun.mjs [--runs 3] [--build]\nCompares already installed Node and Bun running the same local tools.\nBun and dependencies are never installed; lockfiles and remote services are never changed.\n--build also runs Vite production builds, overwriting local dist/.');
  process.exit(0);
}
let runs = 3; let includeBuild = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--runs') {
    runs = Number(args[++index]);
    if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  } else if (args[index] === '--build') includeBuild = true;
  else throw new Error(`Unknown option: ${args[index]}`);
}
const bunVersion = spawnSync('bun', ['--version'], { encoding: 'utf8', cwd: root });
if (bunVersion.error?.code === 'ENOENT') {
  console.log('Bun is not installed. Benchmark skipped; Node/npm remains the verified workflow.\nInstall Bun yourself if you want to compare it, then run this command again.');
  process.exit(0);
}
if (bunVersion.status !== 0) throw new Error(`Bun is installed but failed: ${bunVersion.stderr}`);
console.log(`Node ${process.version}; Bun ${bunVersion.stdout.trim()}; ${runs} measured runs per tool.\nSame installed dependencies and package-lock.json; results depend on this machine and its caches.`);

const tasks = [
  { name: 'TypeScript app check', file: 'node_modules/typescript/bin/tsc', args: ['-p', 'tsconfig.json'] },
  { name: 'TypeScript Worker check', file: 'node_modules/typescript/bin/tsc', args: ['-p', 'tsconfig.worker.json'] },
  { name: 'Vitest suite', file: 'node_modules/vitest/vitest.mjs', args: ['run'] },
  { name: 'Wrangler starts', file: 'node_modules/wrangler/bin/wrangler.js', args: ['--version'] },
];
if (includeBuild) tasks.push({ name: 'Vite build', file: 'node_modules/vite/bin/vite.js', args: ['build'] });
const median = values => {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const results = [];
let failures = false;
for (const task of tasks) {
  const result = { tool: task.name, node: [], bun: [] };
  for (let iteration = 0; iteration < runs; iteration++) {
    for (const runtime of iteration % 2 ? ['bun', 'node'] : ['node', 'bun']) {
      const command = runtime === 'node' ? process.execPath : 'bun';
      const commandArgs = [...(runtime === 'bun' ? ['--bun'] : []), resolve(root, task.file), ...task.args];
      const start = performance.now();
      const output = spawnSync(command, commandArgs, {
        cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' },
      });
      const seconds = (performance.now() - start) / 1000;
      if (output.status !== 0) {
        failures = true;
        console.error(`${task.name} failed under ${runtime}: ${output.error?.message ?? `exit ${output.status}`}\n${(output.stdout + output.stderr).slice(-4_000)}`);
        result[runtime].push(null);
      } else result[runtime].push(seconds);
    }
  }
  const valid = runtime => result[runtime].every(value => value !== null);
  results.push({
    tool: task.name,
    'Node median seconds': valid('node') ? median(result.node).toFixed(3) : 'FAILED',
    'Bun median seconds': valid('bun') ? median(result.bun).toFixed(3) : 'FAILED',
    'Node/Bun ratio': valid('node') && valid('bun') ? (median(result.node) / median(result.bun)).toFixed(2) : 'n/a',
  });
}
console.table(results);
console.log('Package installation, browser speed, Cloudflare runtime speed, full Wrangler deploy compatibility, and Playwright/native install behavior are not measured. Tools may launch subprocesses under Node. No lockfile migration is implied.');
if (failures) process.exitCode = 1;
