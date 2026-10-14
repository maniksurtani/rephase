import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript command modules intentionally have no declaration files.
import { assertMinimumNode, assertPortAvailable, cleanupChildProcesses, isBuildOutdated, parseArguments, waitForHttp } from '../scripts/launch.mjs';

const temporaryDirectories: string[] = [];
afterEach(async () => { for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('local launcher', () => {
  it('rejects an unsupported Node runtime and accepts current supported versions', () => {
    expect(() => assertMinimumNode('22.12.0')).toThrow('22.13');
    expect(() => assertMinimumNode('20.19.0')).toThrow('22.13');
    expect(() => assertMinimumNode('22.13.0')).not.toThrow();
    expect(() => assertMinimumNode('24.0.0')).not.toThrow();
  });

  it('supports explicit modes/ports and rejects ambiguous modes or colliding ports', () => {
    expect(parseArguments(['--static', '--port', '5180', '--no-open'])).toMatchObject({ mode: 'static', port: 5180, open: false });
    expect(parseArguments(['--production', '--worker-port', '8790'])).toMatchObject({ mode: 'production', workerPort: 8790 });
    expect(() => parseArguments(['--static', '--production'])).toThrow('only one');
    expect(() => parseArguments(['--port', '8787'])).toThrow('different ports');
    expect(() => parseArguments(['--worker-port', '8787; echo bad'])).toThrow('integer');
  });

  it('fails on an occupied port and leaves its existing server alive', async () => {
    const owner = createServer();
    await new Promise<void>((done) => owner.listen(0, '127.0.0.1', done));
    const address = owner.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await expect(assertPortAvailable(port)).rejects.toThrow('will not stop other processes');
      expect(owner.listening).toBe(true);
    } finally { await new Promise<void>((done) => owner.close(() => done())); }
    await expect(assertPortAvailable(port)).resolves.toBeUndefined();
  });

  it('terminates only owned Unix process groups, including their descendants', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null as number | null, signalCode: null, kill: vi.fn() });
    const ended = Object.assign(new EventEmitter(), { pid: 5678, exitCode: 0, signalCode: null, kill: vi.fn() });
    const kill = vi.fn((pid: number, signal: string) => {
      if (signal === 'SIGTERM') { child.exitCode = 0; child.emit('exit', 0); }
      return pid === -1234;
    });
    await cleanupChildProcesses([child, ended], 'linux', kill);
    expect(kill.mock.calls).toEqual([[-1234, 'SIGTERM'], [-1234, 'SIGKILL']]);
    expect(child.kill).not.toHaveBeenCalled();
    expect(ended.kill).not.toHaveBeenCalled();
  });

  it('uses Windows taskkill only for the owned PID and its tree', async () => {
    const spawn = vi.fn(() => {
      const result = new EventEmitter(); queueMicrotask(() => result.emit('exit', 0)); return result;
    });
    await cleanupChildProcesses([{ pid: 2468, exitCode: null, signalCode: null }], 'win32', vi.fn(), spawn);
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/PID', '2468', '/T', '/F'], { stdio: 'ignore' });
  });

  it('rebuilds missing or stale assets while accepting an up-to-date bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rephase-launcher-')); temporaryDirectories.push(directory);
    expect(await isBuildOutdated(directory)).toBe(true);
    await mkdir(join(directory, 'dist')); await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'dist/index.html'), '<html/>');
    await writeFile(join(directory, 'src/app.ts'), 'export const v = 1;');
    await utimes(join(directory, 'src/app.ts'), 100, 100);
    await utimes(join(directory, 'dist/index.html'), 200, 200);
    expect(await isBuildOutdated(directory)).toBe(false);
    await utimes(join(directory, 'src/app.ts'), 300, 300);
    expect(await isBuildOutdated(directory)).toBe(true);
  });

  it('announces readiness only after an HTTP response and aborts when a child stops', async () => {
    const owner = createHttpServer((_request, response) => response.end('ready'));
    await new Promise<void>((done) => owner.listen(0, '127.0.0.1', done));
    const address = owner.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await expect(waitForHttp(`http://127.0.0.1:${port}`, () => false, 1000)).resolves.toBeUndefined();
      await expect(waitForHttp(`http://127.0.0.1:${port}`, () => true, 1000)).rejects.toThrow('stopped before');
    } finally { await new Promise<void>((done) => owner.close(() => done())); }
  });
});
