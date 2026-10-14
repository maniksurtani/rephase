import { spawn } from 'node:child_process';
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDirectory = fileURLToPath(new URL('../', import.meta.url));

export function assertMinimumNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Rephase requires Node.js 22.13 or newer.');
}

export function parseArguments(args) {
  const options = { mode: 'development', open: true, port: 5173, workerPort: 8787, help: false };
  let selectedMode = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--no-open') options.open = false;
    else if (argument === '--static' || argument === '--production') {
      if (selectedMode) throw new Error('Choose only one of --static and --production.');
      options.mode = argument.slice(2); selectedMode = true;
    } else if (argument === '--port' || argument === '--worker-port') {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error(`${argument} must be an integer from 1 to 65535.`);
      }
      options[argument === '--port' ? 'port' : 'workerPort'] = Number(value);
    } else throw new Error(`Unknown launcher option: ${argument}. Use --help for supported options.`);
  }
  if (options.mode === 'development' && options.port === options.workerPort) {
    throw new Error('The UI and Worker must use different ports.');
  }
  return options;
}

export function assertPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', (error) => reject(new Error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop its server or choose another port; Rephase will not stop other processes.`
      : `Cannot listen on port ${port}: ${error.code || 'network error'}.`)));
    server.listen({ port, host, exclusive: true }, () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

export async function isBuildOutdated(root = rootDirectory) {
  let builtAt;
  try { builtAt = (await stat(resolve(root, 'dist/index.html'))).mtimeMs; }
  catch { return true; }
  const candidates = ['src', 'public', 'scripts/build-offline.mjs', 'index.html', 'package.json',
    'package-lock.json', 'vite.config.ts', 'tsconfig.json'];
  async function changed(path) {
    let info;
    try { info = await stat(path); } catch { return false; }
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) if (await changed(resolve(path, entry))) return true;
      return false;
    }
    return info.mtimeMs > builtAt;
  }
  for (const path of candidates) if (await changed(resolve(root, path))) return true;
  return false;
}

/** Stop only the process trees this launcher created. No port-based killing. */
export async function cleanupChildProcesses(children, platform = process.platform, kill = process.kill, spawnProcess = spawn) {
  const running = children.filter((child) => child.pid
    && ((child.exitCode === null && child.signalCode === null) || child.rephaseServer));
  for (const child of running) {
    if (platform === 'win32') {
      await new Promise((done) => {
        const taskkill = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        taskkill.once('error', done); taskkill.once('exit', done);
      });
    } else {
      try { kill(-child.pid, 'SIGTERM'); }
      catch { try { child.kill('SIGTERM'); } catch { /* Already stopped. */ } }
    }
  }
  if (platform !== 'win32' && running.length) {
    let timeout;
    await Promise.race([
      Promise.all(running.map((child) => child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve() : new Promise((done) => child.once('exit', done)))),
      new Promise((done) => { timeout = setTimeout(done, 1500); }),
    ]);
    clearTimeout(timeout);
    for (const child of running) {
      // Wranglers may fork descendants; target its original group even if the parent exited.
      try { kill(-child.pid, 'SIGKILL'); } catch { /* The process group has stopped. */ }
    }
  }
}

function npmCommand() {
  return process.env.npm_execpath
    ? { executable: process.execPath, args: [process.env.npm_execpath], shell: false }
    : { executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [], shell: process.platform === 'win32' };
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

export async function waitForHttp(url, stopped, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopped()) throw new Error('A local server stopped before it was ready.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(5000,Math.max(1,deadline-Date.now()))) });
      if (response.ok) { await response.arrayBuffer(); return; }
    } catch { /* Servers need a short startup window. */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out waiting for ${url}. Check the server output above.`);
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
  child.on('error', () => {}); child.unref();
}

export async function launch(args = process.argv.slice(2)) {
  assertMinimumNode();
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: npm start -- [--static | --production] [--no-open] [--port 5173] [--worker-port 8787]\nDefault: Vite UI and local Worker/D1; --static: browser-only Vite UI; --production: built assets and API on the Worker port.\nInstalls dependencies only when missing. Builds when missing/outdated. Existing credentials are never overwritten.\nUse Ctrl+C to stop all servers created by this launcher.');
    return;
  }
  const ports = options.mode === 'production' ? [options.workerPort] : options.mode === 'static' ? [options.port] : [options.port, options.workerPort];
  // Check before creating local configuration, installing dependencies or migrating.
  for (const port of ports) await assertPortAvailable(port);
  const children = [];
  let stopping = false;
  let failure;
  let resolveStopped;
  const stoppedPromise = new Promise((done) => { resolveStopped = done; });
  const stop = () => { stopping = true; resolveStopped(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  function start(executable, commandArgs, environment = {}, shell = false) {
    if (stopping) throw new Error('Launch cancelled.');
    const child = spawn(executable, commandArgs, {
      cwd: rootDirectory, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...environment },
      stdio: 'inherit', detached: process.platform !== 'win32', shell,
    });
    children.push(child);
    return child;
  }
  async function command(executable, commandArgs, environment, shell) {
    const child = start(executable, commandArgs, environment, shell);
    await new Promise((done, reject) => {
      child.once('error', () => reject(new Error('Could not start a local command. Ensure Node.js/npm are installed.')));
      child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`Local setup command stopped (${signal || code}).`)));
      stoppedPromise.then(() => { if (stopping) reject(new Error('Launch cancelled.')); });
    });
  }
  function server(script, commandArgs, environment = {}) {
    const child = start(process.execPath, [script, ...commandArgs], environment);
    child.rephaseServer = true;
    child.once('error', () => { failure = new Error('Could not start a local server.'); stop(); });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        // Wrangler's terminal shortcuts can consume Ctrl+C before the parent
        // receives SIGINT. A clean server exit also means a normal local stop.
        if(code!==0)failure = new Error(`A local server exited (${signal || code}); stopping its companion server.`);
        stop();
      }
    });
  }
  try {
    const npm = npmCommand();
    if (!(await exists(resolve(rootDirectory, 'node_modules/vite/bin/vite.js')))
        || !(await exists(resolve(rootDirectory, 'node_modules/wrangler/bin/wrangler.js')))) {
      console.log('Installing local dependencies…');
      await command(npm.executable, [...npm.args, await exists(resolve(rootDirectory, 'package-lock.json')) ? 'ci' : 'install'], {}, npm.shell);
    }
    const vite = resolve(rootDirectory, 'node_modules/vite/bin/vite.js');
    const wrangler = resolve(rootDirectory, 'node_modules/wrangler/bin/wrangler.js');
    const origin = `http://localhost:${options.mode === 'production' ? options.workerPort : options.port}`;
    if (options.mode !== 'static') {
      try {
        await writeFile(resolve(rootDirectory, '.dev.vars'),
          `# Local settings. This ignored file is never overwritten by the launcher.\nGOOGLE_CLIENT_ID=""\nALLOWED_ORIGIN="${origin}"\nRAPIDAPI_KEY=""\n`,
          { flag: 'wx', mode: 0o600 });
        console.log('Created .dev.vars with empty credentials. Local planning works without keys.');
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (await isBuildOutdated()) {
        console.log('Building the static app…');
        await command(npm.executable, [...npm.args, 'run', 'build'], {}, npm.shell);
      }
      console.log('Applying migrations to local D1 only…');
      await command(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'rephase', '--local'], { CI: 'true' });
      server(wrangler, ['dev', '--local', '--ip', '127.0.0.1', '--port', String(options.workerPort), '--var', `ALLOWED_ORIGIN:${origin}`]);
    }
    if (options.mode !== 'production') {
      server(vite, ['--host', '127.0.0.1', '--port', String(options.port), '--strictPort'], { REPHASE_WORKER_PORT: String(options.workerPort) });
    }
    const readiness = [];
    if (options.mode !== 'static') readiness.push(waitForHttp(`http://127.0.0.1:${options.workerPort}/api/config`, () => stopping));
    if (options.mode !== 'production') readiness.push(waitForHttp(`http://127.0.0.1:${options.port}`, () => stopping));
    await Promise.all(readiness);
    if (stopping) return;
    console.log(`\nRephase is ready: ${origin}`);
    if (options.mode === 'development') console.log(`Local API: http://localhost:${options.workerPort}/api/config`);
    if (options.mode === 'static') console.log('Browser-only mode: Google sync and dynamic flight lookup need the local Worker.');
    console.log('For a remote workspace, forward the UI port before opening it on your own device. Press Ctrl+C to stop.');
    if (options.open) openBrowser(origin);
    await stoppedPromise;
    if (failure) throw failure;
  } catch (error) {
    if (!stopping || failure) throw error;
  } finally {
    stopping = true;
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await cleanupChildProcesses(children);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await launch(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
