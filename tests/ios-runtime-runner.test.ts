import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
// @ts-expect-error CI command modules are plain Node ESM without declaration files.
import { runIosRuntimeTest } from '../scripts/run-ios-runtime-test.mjs';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      const pid = Number(await readFile(join(directory, 'descendant'), 'utf8').catch(() => '0'));
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function fixture(scenario: string, onOutput?: (text: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'rephase-ios-watchdog-'));
  directories.push(directory);
  const logDir = join(directory, 'logs');
  const flutter = join(directory, 'flutter.mjs');
  const xcrun = join(directory, 'xcrun.mjs');
  const reportDirectory = join(directory, 'Library/Logs/DiagnosticReports');
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    flutter,
    String.raw`#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const directory = ${JSON.stringify(directory)}, scenario = ${JSON.stringify(scenario)};
const countFile = directory + '/attempts';
const attempt = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) + 1 : 1;
writeFileSync(countFile, String(attempt));
appendFileSync(directory + '/commands', JSON.stringify(['flutter', ...process.argv.slice(2)]) + '\n');
const wait = () => { console.log('Waiting for VM Service port to be available...'); setInterval(() => {}, 100); };
const start = () => console.log('REPHASE_IOS_TEST_STARTED');
const pass = () => { start(); console.log('All tests passed.'); console.error('driver stderr preserved'); };
const stubbornChild = () => {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', "const fs=require('fs'); process.on('SIGTERM',()=>{}); setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),10); setTimeout(()=>process.exit(),5000)", directory + '/heartbeat'], { stdio: 'ignore' });
  writeFileSync(directory + '/descendant', String(child.pid));
};
if (scenario === 'retry-success' && attempt === 2) pass();
else if (scenario === 'retry-success') { stubbornChild(); wait(); }
else if (scenario === 'success') pass();
else if (scenario === 'explicit-failure') { start(); console.error('EXCEPTION CAUGHT BY FLUTTER TEST: Expected true, actual false'); process.exitCode = 1; }
else if (scenario === 'early-failure') { console.error('Could not install application'); process.exitCode = 1; }
else if (scenario === 'missing-proof') { start(); }
else if (scenario === 'false-success') { pass(); process.exitCode = 1; }
else if (scenario === 'runtime-hang') { start(); wait(); }
else if (scenario === 'unknown-hang') { console.log('Preparing Flutter startup'); setInterval(() => {}, 100); }
else if (scenario === 'large-chunk') { process.stdout.write('REPHASE_IOS_TEST_STARTED\n' + 'x'.repeat(100000) + '\n'); wait(); }
else if (scenario === 'crash-output') { console.error('Unhandled exception: native bootstrap failed'); wait(); }
else if (scenario === 'crash-report') { writeFileSync(${JSON.stringify(join(reportDirectory, 'Runner-test.ips'))}, 'native crash'); wait(); }
else if (scenario === 'cancel') {
  stubbornChild();
  wait();
} else wait();
`,
    { mode: 0o755 },
  );
  await writeFile(
    xcrun,
    String.raw`#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(directory, 'commands'))}, JSON.stringify(['xcrun', ...process.argv.slice(2)]) + '\n');
if (${JSON.stringify(scenario)} === 'restart-failure' && process.argv[3] === 'boot') process.exit(1);
const heartbeat = ${JSON.stringify(join(directory, 'heartbeat'))};
if (process.argv[3] === 'shutdown' && existsSync(heartbeat)) {
  const previous = readFileSync(heartbeat, 'utf8');
  await new Promise((done) => setTimeout(done, 80));
  if (readFileSync(heartbeat, 'utf8') !== previous) throw Error('Flutter descendant was still running during simulator restart');
}
console.log('simulator diagnostic output');
`,
    { mode: 0o755 },
  );
  let text = '';
  const options = {
    device: 'test-simulator',
    logDir,
    cwd: directory,
    flutter,
    xcrun,
    homeDirectory: directory,
    timeouts: { startup: 1500, runtime: 700, command: 1500, boot: 1500, grace: 40 },
    output: new Writable({
      write(chunk, _encoding, done) {
        const value = chunk.toString();
        text += value;
        onOutput?.(value);
        done();
      },
    }),
  };
  return {
    options,
    directory,
    logDir,
    output: () => text,
    commands: async () =>
      (await readFile(join(directory, 'commands'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[]),
  };
}

describe('iOS runtime startup watchdog', () => {
  it('retries only the VM discovery stall, after diagnostics and restarting the selected simulator', async () => {
    const test = await fixture('retry-success');
    const oldReport = join(test.directory, 'Library/Logs/DiagnosticReports/Runner-old.ips');
    await writeFile(oldReport, 'historical unrelated crash');
    await utimes(oldReport, new Date('2000-01-01Z'), new Date('2000-01-01Z'));
    const result = await runIosRuntimeTest(test.options);
    expect(result.code, test.output()).toBe(0);
    expect(result.attempts.map((attempt: { reason?: string }) => attempt.reason)).toEqual([
      'startup-timeout',
      undefined,
    ]);
    const commands = await test.commands();
    expect(commands.map((command) => (command[0] === 'flutter' ? 'flutter' : command[2]))).toEqual([
      'flutter',
      'spawn',
      'shutdown',
      'boot',
      'bootstatus',
      'flutter',
      'spawn',
    ]);
    expect(
      commands
        .filter((command) => command[0] === 'xcrun')
        .every((command) => command[3] === 'test-simulator'),
    ).toBe(true);
    expect(commands[0]).toContain(
      `--use-application-binary=${join(test.directory, 'build/ios/iphonesimulator/Runner.app')}`,
    );
    expect(await readFile(join(test.logDir, 'attempt-1-driver.log'), 'utf8')).toContain(
      'Waiting for VM Service port',
    );
    expect(await readFile(join(test.logDir, 'attempt-2-driver.log'), 'utf8')).toContain(
      'driver stderr preserved',
    );
    expect(await readFile(join(test.logDir, 'attempt-1-simulator.log'), 'utf8')).toContain(
      'simulator diagnostic output',
    );
    expect(JSON.parse(await readFile(join(test.logDir, 'summary.json'), 'utf8')).code).toBe(0);
  }, 15_000);

  it('stops after the second discovery timeout', async () => {
    const test = await fixture('repeat-stall');
    const result = await runIosRuntimeTest(test.options);
    expect(result.code).toBe(1);
    expect(result.attempts).toHaveLength(2);
    expect(
      result.attempts.every((attempt: { reason: string }) => attempt.reason === 'startup-timeout'),
    ).toBe(true);
    expect((await test.commands()).filter((command) => command[2] === 'shutdown')).toHaveLength(1);
  }, 15_000);

  it('does not retry an unknown startup hang without VM discovery evidence', async () => {
    const test = await fixture('unknown-hang');
    const result = await runIosRuntimeTest(test.options);
    expect(result.code).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ waiting: false, reason: 'startup-timeout' });
    expect((await test.commands()).some((command) => command[2] === 'shutdown')).toBe(false);
  }, 15_000);

  it('stops if simulator restart fails without launching another driver', async () => {
    const test = await fixture('restart-failure');
    const result = await runIosRuntimeTest(test.options);
    expect(result.code).toBe(1);
    expect(result.attempts).toHaveLength(1);
    const commands = await test.commands();
    expect(commands.filter((command) => command[0] === 'flutter')).toHaveLength(1);
    expect(commands.map((command) => command[2])).toContain('boot');
    expect(commands.map((command) => command[2])).not.toContain('bootstatus');
    expect(test.output()).toContain('Simulator boot failed');
  }, 15_000);

  it.each(['explicit-failure', 'early-failure', 'false-success', 'missing-proof'])(
    'fails %s without retrying or hiding the failure',
    async (scenario) => {
      const test = await fixture(scenario);
      const result = await runIosRuntimeTest(test.options);
      expect(result.code).toBe(1);
      expect(result.attempts).toHaveLength(1);
      expect((await test.commands()).some((command) => command[2] === 'shutdown')).toBe(false);
    },
    15_000,
  );

  it.each(['runtime-hang', 'large-chunk'])(
    'never retries after tests start, even when their marker precedes a large output chunk (%s)',
    async (scenario) => {
      const test = await fixture(scenario);
      const result = await runIosRuntimeTest(test.options);
      expect(result.code).toBe(1);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]).toMatchObject({ testsStarted: true, reason: 'runtime-timeout' });
      expect((await test.commands()).some((command) => command[2] === 'shutdown')).toBe(false);
    },
    15_000,
  );

  it.each(['crash-output', 'crash-report'])(
    'retains %s evidence and fails without a restart',
    async (scenario) => {
      const test = await fixture(scenario);
      const result = await runIosRuntimeTest(test.options);
      expect(result.code).toBe(1);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].failed || result.attempts[0].crashEvidence).toBe(true);
      expect((await test.commands()).some((command) => command[2] === 'shutdown')).toBe(false);
      if (scenario === 'crash-report')
        expect(await readFile(join(test.logDir, 'attempt-1-1-Runner-test.ips'), 'utf8')).toBe(
          'native crash',
        );
    },
    15_000,
  );

  it('cancels without retry and kills stubborn descendant processes before returning', async () => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const test = await fixture('cancel', (text) => {
      if (text.includes('Waiting for VM Service port'))
        timer = setTimeout(() => abort.abort('SIGINT'), 150);
    });
    try {
      const result = await runIosRuntimeTest({ ...test.options, signal: abort.signal });
      expect(result.code).toBe(130);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].reason).toBe('cancelled');
      expect((await test.commands()).some((command) => command[2] === 'shutdown')).toBe(false);
      const heartbeat = await readFile(join(test.directory, 'heartbeat'), 'utf8');
      await new Promise((done) => setTimeout(done, 80));
      expect(await readFile(join(test.directory, 'heartbeat'), 'utf8')).toBe(heartbeat);
    } finally {
      clearTimeout(timer);
      const pid = Number(
        await readFile(join(test.directory, 'descendant'), 'utf8').catch(() => '0'),
      );
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* Already stopped. */
        }
      }
    }
  }, 15_000);
});
