// Validate real installer contents, with isolated data and no GPU initialization.
import {spawn} from 'node:child_process';
import {mkdtemp, readdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {releaseDirectory} from './stage.mjs';
import {releaseEnvironment} from './runtime.mjs';

const scratch = await mkdtemp(path.join(tmpdir(), 'Framecraft release '));
const artifacts = path.join(releaseDirectory, 'artifacts');
const files = await readdir(artifacts);
const env = {...process.env, FRAMECRAFT_DISABLE_GPU: '1', LIBGL_ALWAYS_SOFTWARE: '1', WEBKIT_DISABLE_DMABUF_RENDERER: '1'};
for(const name of ['FRAMECRAFT_ROOT', 'FRAMECRAFT_NODE', 'LD_LIBRARY_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH', 'CHROME_PATH', 'FRAMECRAFT_VULKAN_FFMPEG', 'FRAMECRAFT_AGENT_WORKSPACE']) delete env[name];

function execute(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {quiet = false, ...spawnOptions} = options;
    const child = spawn(binary, args, {cwd: scratch, env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true, ...spawnOptions});
    let output = '';
    if(quiet) for(const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {output = (output + chunk).slice(-8000);});
    const timer = setTimeout(() => {child.kill(); reject(new Error(`Timed out: ${path.basename(binary)}`));}, 180000);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('exit', (code, signal) => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${binary} failed: ${signal || code}\n${output}`));});
  });
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function findApp(directory) {
  for(const name of await readdir(directory)) {
    const app = path.join(directory, name, 'app');
    if(await stat(path.join(app, 'release.json')).catch(() => null)) return app;
  }
  throw new Error(`Bundled application resources not found in ${directory}`);
}
async function verify(executable, app, label) {
  const testEnv = await releaseEnvironment(app, {...env, PORT: String(await freePort()), FRAMECRAFT_DATA_DIR: path.join(scratch, label, 'data')});
  const node = path.join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  await execute(node, ['--input-type=module', '-e', "import sharp from 'sharp'; import '@remotion/renderer'; import 'tsx/esm/api'; const image=await sharp('public/demo/demo-world.png').metadata(); if(!image.width) throw Error('Missing built-in assets');"], {cwd: app, env: testEnv});
  await execute(testEnv.FFMPEG_PATH, ['-version'], {env: testEnv});
  await execute(testEnv.FFPROBE_PATH, ['-version'], {env: testEnv});
  const child = spawn(node, [path.join(app, 'scripts/desktop-backend.mjs')], {cwd: scratch, env: testEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  let output = ''; let ended = false;
  child.stdout.on('data', chunk => {output += chunk;}); child.stderr.pipe(process.stderr);
  const closed = new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', () => {ended = true; resolve();});});
  closed.catch(() => {});
  const url = `http://127.0.0.1:${testEnv.PORT}`;
  const client = new Client({name: 'release-smoke', version: '1.0.0'});
  try {
    const deadline = Date.now() + 60000;
    while(!ended && !output.includes('"ready"') && Date.now() < deadline) await delay(100);
    if(ended || !output.includes('"ready"')) throw new Error(`Packaged backend did not start: ${output}`);
    const status = await (await fetch(`${url}/api/status`)).json();
    if(path.resolve(status.rootDir) !== path.resolve(app) || !path.resolve(status.projectPath).startsWith(testEnv.FRAMECRAFT_DATA_DIR + path.sep)) throw new Error('Backend used checkout resources or wrong user data.');
    const page = await fetch(url); if(!page.ok || !(await page.text()).includes('<div id="root">')) throw new Error('Packaged editor UI missing.');
    await client.connect(new StdioClientTransport({command: node, args: [path.join(app, 'scripts/mcp.mjs')], cwd: scratch, env: {...testEnv, FRAMECRAFT_URL: url}, stderr: 'inherit'}));
    const result = await client.listTools(); if(result.tools.length < 20) throw new Error('Packaged MCP tool inventory is incomplete.');
    const project = await client.callTool({name: 'get_project', arguments: {}}); if(project.isError) throw new Error('Packaged MCP could not read the project.');
    // Real installed EXE uses OS resource paths and its bundled Node, without
    // FRAMECRAFT_ROOT/NODE overrides. Attach to the isolated supervisor above.
    await execute(executable, ['--release-smoke'], {env: testEnv});
  } finally {
    try {await client.close();}
    finally {
      if(!ended) child.stdin.end('shutdown\n');
      const timer = setTimeout(() => child.kill(), 8000);
      try {await closed;} finally {clearTimeout(timer);}
    }
  }
  console.log(`${label}: installed native executable, backend, media runtime, UI, user data and MCP passed. No GPU rendering was run.`);
}
try {
  if(process.platform === 'win32') {
    const installer = files.find(name => name.endsWith('-setup.exe')); if(!installer) throw new Error('NSIS installer missing.');
    const destination = path.join(scratch, 'Installed Framecraft');
    // NSIS requires /D last, with its path unquoted even when it contains spaces.
    await execute(path.join(artifacts, installer), ['/S', `/D=${destination}`], {windowsVerbatimArguments: true});
    await verify(path.join(destination, 'framecraft-desktop.exe'), path.join(destination, 'app'), 'windows');
    const uninstaller = (await readdir(destination)).find(name => /^uninstall.*\.exe$/i.test(name));
    if(uninstaller) await execute(path.join(destination, uninstaller), ['/S', `_?=${destination}`], {windowsVerbatimArguments: true});
  } else {
    const deb = files.find(name => name.endsWith('.deb')); const appimage = files.find(name => name.endsWith('.AppImage'));
    if(!deb || !appimage) throw new Error('Linux packages missing.');
    const destination = path.join(scratch, 'deb');
    await execute('dpkg-deb', ['-x', path.join(artifacts, deb), destination]);
    await verify(path.join(destination, 'usr/bin/framecraft-desktop'), await findApp(path.join(destination, 'usr/lib')), 'deb');
    await execute(path.join(artifacts, appimage), ['--appimage-extract'], {quiet: true});
    const appdir = path.join(scratch, 'squashfs-root');
    await verify(path.join(appdir, 'AppRun'), await findApp(path.join(appdir, 'usr/lib')), 'appimage');
  }
} catch(error) {
  const logs = await Promise.all(['windows', 'deb', 'appimage'].map(async label => {
    const content = await readFile(path.join(scratch, label, 'data/desktop.log'), 'utf8').catch(() => '');
    return content ? `${label}:\n${content.slice(-100000)}` : '';
  }));
  await writeFile(path.join(releaseDirectory, 'smoke.log'), [error.stack || String(error), ...logs].join('\n'));
  console.error(`Release smoke failed; temporary files: ${scratch}`);
  throw error;
}
// Only this script's isolated temporary installation/data are removed.
await rm(scratch, {recursive: true, force: true, maxRetries: 5, retryDelay: 500});
