import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaults = {
  startup: 180_000,
  runtime: 180_000,
  command: 30_000,
  boot: 120_000,
  grace: 2_000,
};

/** Run the precompiled test app. Only a proven pre-test VM discovery timeout may retry. */
export async function runIosRuntimeTest({
  device,
  logDir,
  flutter = process.env.FLUTTER_BIN || 'flutter',
  xcrun = 'xcrun',
  cwd = resolve(root, 'mobile'),
  timeouts = {},
  signal,
  output = process.stdout,
  homeDirectory = homedir(),
}) {
  if (!device || !logDir) throw new Error('Both --device and --log-dir are required.');
  const limits = { ...defaults, ...timeouts };
  await mkdir(logDir, { recursive: true });
  const attempts = [];
  const cancelledCode = () => (signal?.reason === 'SIGINT' ? 130 : 143);

  async function command(
    executable,
    args,
    file,
    { driver = false, timeout = limits.command } = {},
  ) {
    if (signal?.aborted) return { code: cancelledCode(), reason: 'cancelled' };
    const log = createWriteStream(join(logDir, file), { flags: 'a' });
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let reason,
      timer,
      killTimer,
      tail = '',
      waiting = false,
      testsStarted = false,
      passed = false,
      failed = false;
    const killGroup = (value) => {
      try {
        process.kill(-child.pid, value);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const stop = (value) => {
      if (reason) return;
      reason = value;
      if (child.pid) killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.pid) killGroup('SIGKILL');
      }, limits.grace);
    };
    const arm = (duration) => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          stop(driver ? (testsStarted ? 'runtime-timeout' : 'startup-timeout') : 'command-timeout'),
        duration,
      );
    };
    const onAbort = () => stop('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    arm(driver ? limits.startup : timeout);
    const receive = (chunk) => {
      log.write(chunk);
      output.write(chunk);
      const text = tail + chunk.toString();
      tail = text.slice(-16_384);
      failed ||=
        /EXCEPTION CAUGHT BY FLUTTER TEST|Some tests failed|All tests failed|Test failed|Unhandled exception|\[ERROR:flutter|Lost connection to device|Crash report|SIGABRT|SIGSEGV|EXC_BAD_ACCESS|Terminating app due to uncaught exception/i.test(
          text,
        );
      if (!driver) return;
      waiting ||= text.includes('Waiting for VM Service port to be available');
      passed ||= text.includes('All tests passed');
      if (
        !testsStarted &&
        /REPHASE_IOS_TEST_STARTED|VMServiceFlutterDriver: Connected to Flutter application|flutter:\s*\d+:\d+\s+\+\d+/.test(
          text,
        )
      ) {
        testsStarted = true;
        arm(limits.runtime);
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    const result = await new Promise((done) => {
      child.once('error', (error) => {
        receive(Buffer.from(`${executable}: ${error.message}\n`));
        done({ code: 1, reason: 'spawn-error' });
      });
      // Kill remaining helpers even if their parent exits before the grace timer.
      child.once('exit', () => {
        if (child.pid) killGroup('SIGKILL');
      });
      child.once('close', (code, exitSignal) => done({ code, signal: exitSignal, reason }));
    });
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', onAbort);
    log.end();
    await finished(log);
    return { ...result, waiting, testsStarted, passed, failed };
  }

  async function diagnostics(attempt, started) {
    if (signal?.aborted) return false;
    const prefix = `attempt-${attempt}`;
    // Cover the entire attempt, including startup; --last 5m previously lost it.
    const minutes = Math.max(1, Math.ceil((Date.now() - started) / 60_000) + 1);
    const logs = await command(
      xcrun,
      [
        'simctl',
        'spawn',
        device,
        'log',
        'show',
        '--last',
        `${minutes}m`,
        '--style',
        'compact',
        '--predicate',
        'process == "Runner"',
      ],
      `${prefix}-simulator.log`,
    );
    let crashEvidence = logs.failed;
    const sources = [join(homeDirectory, 'Library/Logs/CoreSimulator/CoreSimulator.log')];
    for (const directory of [
      join(homeDirectory, 'Library/Logs/DiagnosticReports'),
      join(
        homeDirectory,
        'Library/Developer/CoreSimulator/Devices',
        device,
        'data/Library/Logs/CrashReporter',
      ),
    ]) {
      const names = await readdir(directory).catch(() => []);
      sources.push(
        ...names
          .filter((name) => /^Runner.*\.(ips|crash)$/.test(name))
          .map((name) => join(directory, name)),
      );
    }
    for (const [index, source] of sources.entries()) {
      if (index > 0) crashEvidence ||= (await stat(source).catch(() => null))?.mtimeMs >= started;
      await copyFile(source, join(logDir, `${prefix}-${index}-${basename(source)}`)).catch(
        () => {},
      );
    }
    return Boolean(crashEvidence);
  }

  let code = 1;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) {
        code = cancelledCode();
        break;
      }
      const started = Date.now();
      output.write(`\nRephase iOS runtime attempt ${attempt}/2\n`);
      const result = await command(
        flutter,
        [
          'drive',
          '--no-dds',
          '--verbose',
          '--no-pub',
          '--driver=test_driver/integration_test.dart',
          '--target=integration_test/offline_engine_test.dart',
          `--use-application-binary=${resolve(cwd, 'build/ios/iphonesimulator/Runner.app')}`,
          '-d',
          device,
        ],
        `attempt-${attempt}-driver.log`,
        { driver: true },
      );
      const item = { attempt, ...result, durationMs: Date.now() - started };
      attempts.push(item);
      item.crashEvidence = await diagnostics(attempt, started);
      if (signal?.aborted || result.reason === 'cancelled') {
        code = cancelledCode();
        break;
      }
      if (
        result.code === 0 &&
        !result.reason &&
        result.testsStarted &&
        result.passed &&
        !result.failed &&
        !item.crashEvidence
      ) {
        code = 0;
        break;
      }
      const retry =
        attempt === 1 &&
        result.reason === 'startup-timeout' &&
        result.waiting &&
        !result.testsStarted &&
        !result.failed &&
        !item.crashEvidence;
      if (!retry) break;
      output.write(
        'VM discovery timed out before tests began. Restarting the selected simulator once.\n',
      );
      for (const [operation, timeout] of [
        ['shutdown', limits.command],
        ['boot', limits.command],
        ['bootstatus', limits.boot],
      ]) {
        const args = ['simctl', operation, device, ...(operation === 'bootstatus' ? ['-b'] : [])];
        const restarted = await command(xcrun, args, 'simulator-restart.log', { timeout });
        if (restarted.code !== 0 || restarted.reason)
          throw new Error(`Simulator ${operation} failed; no further retry.`);
      }
    }
  } catch (error) {
    output.write(`${error.message}\n`);
    code = signal?.aborted ? cancelledCode() : 1;
  } finally {
    await writeFile(
      join(logDir, 'summary.json'),
      `${JSON.stringify({ code, attempts }, null, 2)}\n`,
    );
  }
  return { code, attempts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/run-ios-runtime-test.mjs --device <UDID> --log-dir <directory>\nRequires a precompiled mobile/build/ios/iphonesimulator/Runner.app integration test.',
    );
  } else {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = { '--device': 'device', '--log-dir': 'logDir' }[args[index]];
      if (!key || !args[index + 1] || options[key])
        throw new Error('Use --device <UDID> and --log-dir <directory> only.');
      options[key] = args[index + 1];
    }
    const abort = new AbortController();
    const interrupt = () => abort.abort('SIGINT');
    const terminate = () => abort.abort('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      process.exitCode = (await runIosRuntimeTest({ ...options, signal: abort.signal })).code;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }
}
