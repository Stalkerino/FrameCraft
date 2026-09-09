import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {demoArtwork} from '../shared/demo.ts';
import {comparisonCommands} from './docs-scene.ts';

// Run with `node --import tsx scripts/capture-docs.mjs` after npm run build.
// Add --color-only to update the grading screenshot without regenerating media.
// Every project, imported file and server process belongs to this isolated capture.
// Codex is never started: its screenshot shows a disconnected panel and an unsent draft.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colorOnly = process.argv.includes('--color-only');
const screenshots = path.join(root, 'docs', 'screenshots');
const executablePath = process.env.CHROME_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
if(!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Build the editor first with npm run build.');
await mkdir(path.join(root, '.cache'), {recursive: true});
await mkdir(screenshots, {recursive: true});
const directory = await mkdtemp(path.join(root, '.cache', 'docs-capture-'));
let server;
let browser;
let serverLog = '';

async function run(binary, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let error = '';
    child.stderr.on('data', chunk => {error = (error + chunk).slice(-4000);});
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${binary} ${signal || `exit ${code}`}: ${error}`)));
  });
}

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);});
  const {port} = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stopServer() {
  if(!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => {clearTimeout(timer); resolve();});
    server.kill('SIGTERM');
  });
}

try {
  const port = await unusedPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const env = {...process.env, PORT: String(port), FRAMECRAFT_HOST: '127.0.0.1', FRAMECRAFT_DATA_DIR: directory, FRAMECRAFT_LIBRARY_DIR: path.join(directory, 'asset-library'), CHROME_PATH: executablePath};
  // Do not inherit a test fixture CLI configured in the caller's environment.
  delete env.FRAMECRAFT_CODEX_PATH;
  server = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server', 'index.ts')], {cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', chunk => {serverLog = (serverLog + chunk).slice(-4000);});
  server.stderr.on('data', chunk => {serverLog = (serverLog + chunk).slice(-4000);});
  let launchError;
  server.once('error', error => {launchError = error;});
  const api = async (route, data) => {
    const response = await fetch(baseURL + route, {signal: AbortSignal.timeout(30000), ...(data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})});
    if(!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  for(let attempt = 0; ; attempt++) {
    if(launchError) throw launchError;
    if(server.exitCode !== null || server.signalCode !== null) throw new Error(`Capture server stopped: ${serverLog}`);
    try {await api('/api/project'); break;} catch(error) {if(attempt >= 100) throw new Error(`Capture server did not start: ${error.message}\n${serverLog}`); await delay(100);}
  }
  const studio = (await api('/api/project')).project;
  browser = await chromium.launch({executablePath, headless: true});
  const context = await browser.newContext({baseURL, viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1, colorScheme: 'dark'});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if(!localStorage.getItem('framecraft.workspace.v1')) localStorage.setItem('framecraft.workspace.v1', JSON.stringify({preset: 'custom', libraryWidth: 320, inspectorWidth: 340, timelineHeight: 330, showLibrary: true, showInspector: true, snapping: true, followPlayhead: true}));
  });
  async function capture(name) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      const visible = [...document.images].filter(image => {const box = image.getBoundingClientRect(); return box.width && box.height && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0;});
      await Promise.race([Promise.all(visible.map(image => image.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 2000))]);
    });
    await page.mouse.move(1580, 970);
    await page.screenshot({path: path.join(screenshots, `${name}.png`), animations: 'disabled'});
    console.log(`Captured docs/screenshots/${name}.png`);
  }
  async function seek(seconds) {
    const ruler = page.locator('.ruler-area');
    const bounds = await ruler.boundingBox();
    if(!bounds) throw new Error('Timeline ruler is unavailable');
    await page.mouse.click(bounds.x + seconds * 48, bounds.y + bounds.height / 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.preview video')].every(video => video.readyState >= 2 && !video.seeking));
  }
  async function layout(values) {
    await page.evaluate(values => localStorage.setItem('framecraft.workspace.v1', JSON.stringify({...JSON.parse(localStorage.getItem('framecraft.workspace.v1') || '{}'), ...values})), values);
    await page.reload();
    await page.getByText('All changes saved', {exact: true}).waitFor();
  }
  async function captureColorGrading() {
    const project = (await api('/api/project')).project;
    await api('/api/commands', {revision: project.revision, label: 'Prepare documentation color grade', commands: [{type: 'clip.update', id: 'scene-1', patch: {opacity: .85, colorGrade: {exposure: .2, temperature: .5, contrast: 1.1, saturation: .85}}}]});
    const viewport = page.viewportSize();
    await page.setViewportSize({width: 1600, height: 1100});
    await layout({libraryWidth: 290, inspectorWidth: 380, timelineHeight: 220});
    await page.getByRole('navigation', {name: 'Editor tools'}).getByRole('button', {name: 'Media', exact: true}).click();
    await page.getByRole('button', {name: 'Select The new world', exact: true}).click();
    await seek(2);
    for(const title of ['Timing & track', 'Transition in', 'Audio']) {
      const opened = page.locator('.inspector details[open] > summary').filter({has: page.getByRole('heading', {name: title, exact: true})});
      if(await opened.count()) await opened.click();
    }
    const grading = page.locator('.inspector details > summary').filter({has: page.getByRole('heading', {name: 'Color grading', exact: true})});
    await grading.click();
    await page.getByRole('spinbutton', {name: 'Exposure', exact: true}).waitFor();
    if(await page.getByRole('spinbutton', {name: 'Opacity', exact: true}).inputValue() !== '85') throw new Error('The grading screenshot did not load its opacity edit.');
    const canvasEditing = page.getByRole('button', {name: 'Edit elements on canvas', exact: true});
    if(await canvasEditing.getAttribute('aria-pressed') === 'true') await canvasEditing.click();
    await capture('color-grading');
    await page.setViewportSize(viewport);
  }
  await page.goto('/');
  await page.getByRole('textbox', {name: 'Text content'}).waitFor();
  if(colorOnly) await captureColorGrading();
  else {
  await seek(2);
  await capture('studio');

  const media = path.join(directory, 'capture-media');
  await mkdir(media);
  const videoFiles = [];
  for(const [index, label] of ['Before lighting', 'After atmosphere'].entries()) {
    const png = path.join(media, `${label}.png`);
    const video = path.join(media, `${label}.mp4`);
    await sharp(Buffer.from(demoArtwork(index))).resize(1280, 720).png().toFile(png);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', '24', '-threads', '1', '-i', png, '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', '-y', video]);
    videoFiles.push(video);
  }
  await api('/api/projects', {action: 'new', name: 'Lighting pass · Before / after', revision: (await api('/api/project')).project.revision, settings: {width: 1280, height: 720, fps: 24}});
  for(const filePath of videoFiles) await api('/api/import-path', {filePath});
  const comparison = (await api('/api/project')).project;
  const wipe = (await api('/api/asset-presets')).presets.find(preset => preset.id === 'comparison-wipe-horizontal');
  if(!wipe) throw new Error('The comparison preset is unavailable. Rebuild the current editor.');
  await api('/api/commands', {revision: comparison.revision, commands: comparisonCommands(comparison.assets[0], comparison.assets[1], wipe), label: 'Prepare documentation comparison'});
  await layout({timelineHeight: 390});
  await page.getByRole('button', {name: 'Select After · Atmosphere pass', exact: true}).click();
  await seek(2);
  await page.getByRole('slider', {name: 'Timeline zoom', exact: true}).press('End');
  for(const title of ['Timing & track', 'Transform']) await page.locator('.inspector details[open] > summary').filter({hasText: title}).click();
  await page.getByRole('button', {name: 'Edit elements on canvas', exact: true}).click();
  await capture('comparisons');

  await api('/api/projects', {action: 'open', id: studio.id, revision: (await api('/api/project')).project.revision});
  await layout({libraryWidth: 450, inspectorWidth: 300, timelineHeight: 300});
  await page.getByRole('button', {name: 'Presets', exact: true}).click();
  await page.getByRole('button', {name: 'Open Comparison · Left to right preset', exact: true}).waitFor();
  await seek(2);
  await capture('assets');

  await page.getByRole('navigation', {name: 'Editor tools'}).getByRole('button', {name: 'Audio', exact: true}).click();
  await page.getByRole('button', {name: 'Sound library', exact: true}).click();
  await page.locator('.sound-card__details').filter({hasText: 'Soft whoosh'}).click();
  await page.getByRole('dialog', {name: 'Sound settings', exact: true}).waitFor();
  await capture('sounds');
  await page.getByRole('button', {name: 'Close sound settings', exact: true}).click();
  await captureColorGrading();

  await layout({libraryWidth: 290, inspectorWidth: 500, timelineHeight: 300});
  await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  await page.getByRole('textbox', {name: 'Message Codex'}).fill('Compare the two lighting passes with a left-to-right wipe. Add BEFORE / AFTER labels, then save the transition so I can reuse it in my next devlog.');
  await seek(2);
  await capture('codex');
  }
  if(errors.length) throw new Error(`The captured UI reported errors: ${errors.join('\n')}`);
  for(const obsolete of ['codex-chat.png', 'codex-expanded.png']) await rm(path.join(screenshots, obsolete), {force: true});
} finally {
  await browser?.close();
  await stopServer();
  await rm(directory, {recursive: true, force: true});
}
