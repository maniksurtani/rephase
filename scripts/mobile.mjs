import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMobileEngine } from './build-mobile-engine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = resolve(root, 'mobile');
const [command = 'run', ...extra] = process.argv.slice(2);
const flutter = process.env.FLUTTER_BIN || 'flutter';

if (['--help', '-h', 'help'].includes(command)) {
  console.log(`Usage: npm run mobile -- <command> [Flutter options]
  run       Build the offline engine and launch on a connected device/simulator.
  check     Format check, analyze and test the Flutter app.
  apk       Build a debug Android APK for local testing.
  ios       Build an unsigned iOS Simulator app (macOS/Xcode required).
  engine    Rebuild the bundled offline planner only.

Optional mobile/config.json: copy mobile/config.example.json and add the public
Google iOS OAuth client ID. Android needs a registered OAuth client for the app
ID and signing certificate. Guest planning needs no OAuth setup.
Set FLUTTER_BIN if flutter is not on PATH. See mobile/README.md.`);
  process.exit(0);
}
if (!['run', 'check', 'apk', 'ios', 'engine'].includes(command)) {
  throw new Error('Unknown command. Use npm run mobile -- --help.');
}

function run(executable, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: mobile, stdio: 'inherit' });
    child.once('error', (error) => reject(new Error(
      error.code === 'ENOENT'
        ? 'Flutter was not found. Install the pinned SDK or set FLUTTER_BIN to its executable.'
        : `Could not launch ${executable}.`,
    )));
    child.once('exit', (code, signal) => code === 0
      ? resolveRun()
      : reject(new Error(`The mobile command stopped (${signal || code}).`)));
  });
}

await buildMobileEngine();
if (command === 'engine') process.exit(0);

const configPath = resolve(mobile, 'config.json');
const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) : {};
const allowed = new Set(['API_ORIGIN', 'GOOGLE_IOS_CLIENT_ID', 'GOOGLE_SERVER_CLIENT_ID']);
if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some((key) => !allowed.has(key) || typeof config[key] !== 'string')) {
  throw new Error('Use the public configuration fields in mobile/config.example.json.');
}
for (const name of ['GOOGLE_IOS_CLIENT_ID', 'GOOGLE_SERVER_CLIENT_ID']) {
  const value = config[name];
  if (value && !/^[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(value)) {
    throw new Error(`${name} must be a Google OAuth client ID.`);
  }
}
if (config.API_ORIGIN) {
  const origin = new URL(config.API_ORIGIN);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(origin.hostname);
  if (origin.origin !== config.API_ORIGIN || origin.username || origin.password
      || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local))) {
    throw new Error('API_ORIGIN must be an exact HTTPS origin (or local emulator development origin).');
  }
}
const reverse = config.GOOGLE_IOS_CLIENT_ID
  ? config.GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.')
  : 'org.surtani.rephase.auth';
await writeFile(resolve(mobile, 'ios/Flutter/Google.xcconfig'),
  `// Generated from ignored mobile/config.json; public OAuth IDs only.\nREPHASE_GOOGLE_REVERSED_CLIENT_ID = ${reverse}\n`);

await run(flutter, ['pub', 'get']);
if (command === 'check') {
  await run(flutter.replace(/flutter(?:\.bat)?$/, 'dart'), ['format', '--output=none', '--set-exit-if-changed', 'lib', 'test', 'integration_test']);
  await run(flutter, ['analyze', '--no-pub']);
  await run(flutter, ['test', '--no-pub', ...extra]);
} else {
  if (command === 'ios' && process.platform !== 'darwin') {
    throw new Error('iOS compilation requires macOS with Xcode. The Android app can be built here.');
  }
  const defines = existsSync(configPath) ? [`--dart-define-from-file=${configPath}`] : [];
  const args = command === 'run' ? ['run']
    : command === 'apk' ? ['build', 'apk', '--debug']
      : ['build', 'ios', '--simulator', '--debug', '--no-codesign'];
  await run(flutter, [...args, ...defines, ...extra]);
}
