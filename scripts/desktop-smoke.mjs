import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';

const vendor = process.argv[2];
if(!['amd', 'nvidia'].includes(vendor) || !process.argv.includes('--run')) throw new Error('Opt in with desktop:check -- amd|nvidia --run. Opens one desktop window, two tiny Vulkan clears, max 30 seconds.');
const root = process.cwd(); const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-desktop-surface-'));
const video = process.argv.includes('--video');
if(video) execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/desktop-video-fixture.ts'), directory], {stdio: 'inherit', timeout: 15000});
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const report = path.join(directory, 'surface.json');
const child = spawn(path.join(root, 'src-tauri/target/debug', process.platform === 'win32' ? 'framecraft-desktop.exe' : 'framecraft-desktop'), [], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, FRAMECRAFT_ROOT: root, FRAMECRAFT_NODE: process.execPath, PORT: String(port),
    FRAMECRAFT_DATA_DIR: directory, FRAMECRAFT_LIBRARY_DIR: path.join(directory, 'library'), FRAMECRAFT_DESKTOP_CHECK: vendor, FRAMECRAFT_DESKTOP_CHECK_REPORT: report,
    FRAMECRAFT_DESKTOP_VIDEO_CHECK: video ? '1' : '0', FRAMECRAFT_CODEX_PATH: path.join(root, 'tests/fixtures/fake-codex.mjs')},
});
let log = '';
const output = chunk => {log = (log + chunk).slice(-12000); if(process.env.FRAMECRAFT_DESKTOP_CHECK_VERBOSE === '1') process.stderr.write(chunk);};
child.stdout.on('data', output); child.stderr.on('data', output);
const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
try {
  const [code, signal] = await once(child, 'exit');
  const result = JSON.parse(await readFile(report, 'utf8').catch(() => JSON.stringify({status: 'failed', error: 'No desktop report before exit/deadline.'})));
  console.log(JSON.stringify({...result, exitCode: code, signal, artifacts: directory}, null, 2));
  if(code !== 0 || result.status !== 'passed') {console.error(log); process.exitCode = 1;}
} finally {clearTimeout(timer);}
