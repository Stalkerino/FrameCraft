import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';

const root = process.cwd();
const start = (port: number, data: string) => spawn(process.execPath, ['scripts/desktop-backend.mjs'], {cwd: root,
  env: {...process.env, PORT: String(port), FRAMECRAFT_DATA_DIR: data, FRAMECRAFT_DISABLE_GPU: '1', FRAMECRAFT_CODEX_PATH: path.resolve('tests/fixtures/fake-codex.mjs')}, stdio: ['pipe', 'pipe', 'pipe']});
const ready = (child: ChildProcessWithoutNullStreams) => new Promise<{url: string; ownsBackend: boolean}>((resolve, reject) => {
  let output = ''; let error = '';
  child.stdout.on('data', chunk => {output += chunk; if(output.includes('\n')) {try {resolve(JSON.parse(output.split('\n')[0]));} catch(e) {reject(e);}}});
  child.stderr.on('data', chunk => {error += chunk;});
  child.once('error', reject); child.once('exit', code => reject(new Error(`Backend ${code}: ${error}`)));
});
async function stop(child: ChildProcessWithoutNullStreams) {
  if(child.exitCode !== null) return;
  const done = once(child, 'exit'); child.stdin.end('shutdown\n'); await done;
}

it('attaches only to the matching workspace and leaves its existing server alive', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'framecraft-desktop-test-'));
  const server = createServer((_req, res) => {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({rootDir: root, projectPath: path.join(data, 'project.json')}));});
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as {port: number}).port;
  const child = start(port, data);
  try {
    expect(await ready(child)).toEqual({event: 'ready', url: `http://127.0.0.1:${port}`, ownsBackend: false});
    await stop(child); expect((await fetch(`http://127.0.0.1:${port}/api/status`)).ok).toBe(true);
    const wrong = start(port, path.join(data, 'different')); const exited = once(wrong, 'exit'); let message = '';
    wrong.stderr.on('data', chunk => {message += chunk;});
    expect((await exited)[0]).toBe(1); expect(message).toContain('Another Framecraft workspace');
  } finally {await stop(child); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(data, {recursive: true, force: true});}
});

it('starts an isolated real backend and closes only that owned server through IPC', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'framecraft-desktop-owned-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as {port: number}).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = start(port, data);
  try {
    const info = await ready(child); expect(info.ownsBackend).toBe(true);
    expect((await (await fetch(`${info.url}/api/project`)).json()).project.id).toBeTruthy();
    await stop(child); await expect(fetch(`${info.url}/api/status`)).rejects.toThrow();
  } finally {await stop(child); await rm(data, {recursive: true, force: true});}
}, 20000);
