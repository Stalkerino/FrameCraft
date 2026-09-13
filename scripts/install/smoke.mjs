// Runs only when explicitly invoked: isolated project, no render/GPU work.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {root, installationCurrent, run} from './runtime.mjs';
import {framecraftAt} from '../web/launch.mjs';
if(!await installationCurrent()) throw new Error('Run the installer before the smoke test.');
const port = Number(process.env.FRAMECRAFT_SMOKE_PORT || 14318);
const url = `http://127.0.0.1:${port}`;
if(await framecraftAt(url)) throw new Error(`Smoke-test port ${port} is already occupied.`);
const data = await mkdtemp(path.join(tmpdir(), 'framecraft-install-'));
const child = spawn(process.execPath, [path.join(root, 'scripts/web/launch.mjs'), '--no-open'], {cwd: root, stdio: 'inherit', env: {...process.env,
  PORT: String(port), FRAMECRAFT_DATA_DIR: data, FRAMECRAFT_LIBRARY_DIR: path.join(data, 'library')}});
let ended = false;
const closed = new Promise((resolve, reject) => {child.once('error', error => {ended = true; reject(error);}); child.once('exit', code => {ended = true; resolve(code);});});
closed.catch(() => {});
try {
  const deadline = Date.now() + 45000;
  while(!ended && Date.now() < deadline && !await framecraftAt(url)) await delay(300);
  if(ended || !await framecraftAt(url)) throw new Error('Installed launcher did not start Framecraft.');
  const response = await fetch(url); if(!response.ok || !(await response.text()).includes('<div id="root">')) throw new Error('Built editor page was not served.');
  console.log('Installed launcher and editor HTTP endpoint passed. No GPU work was run.');
} finally {
  if(!ended) {
    if(process.platform === 'win32') await run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {capture: true});
    else child.kill('SIGTERM');
  }
  await closed;
  await rm(data, {recursive: true, force: true});
}
