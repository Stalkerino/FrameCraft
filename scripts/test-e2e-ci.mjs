import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {root} from './install/runtime.mjs';

// Each spec gets its own Playwright invocation, backend and temporary project.
// Keep one worker per machine: these tests intentionally edit a live timeline.
const {values, positionals} = parseArgs({allowPositionals: true, options: {shard: {type: 'string', default: '1/1'}, list: {type: 'boolean'}}});
const match = /^(\d+)\/(\d+)$/.exec(values.shard);
if(!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) throw new Error('Use --shard=1/3, 2/3 or 3/3 (index/total).');
const [, part, total] = match.map(Number);
const directory = path.join(root, 'tests/e2e');
const specs = (await readdir(directory)).filter(name => name.endsWith('.spec.ts')).sort();
const requested = new Set(positionals.map(file => path.basename(file)));
for(const file of requested) if(!specs.includes(file)) throw new Error(`Unknown E2E spec: ${file}`);
const selected = specs.filter((file, index) => index % total === part - 1 && (!requested.size || requested.has(file)));
if(!selected.length) throw new Error('No test files selected.');
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
if(process.env.CI && !values.list) {
  if(!process.env.CHROME_PATH) throw new Error('CI playback tests require CHROME_PATH from the Chrome setup step.');
  const {chromium} = await import('@playwright/test');
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH, args: ['--disable-gpu', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode']});
  try {
    const page = await browser.newPage();
    const support = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'));
    if(!support) throw new Error('CI browser cannot decode H.264/AAC fixtures. Install Google Chrome with media codecs.');
    console.log(`CI browser ${browser.version()} · H.264/AAC: ${support}`);
  } finally {await browser.close();}
}
for(const [index, file] of selected.entries()) {
  console.log(`\nE2E shard ${part}/${total} · ${index + 1}/${selected.length} · ${file} · fresh editor`);
  if(values.list) continue;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', `tests/e2e/${file}`, '--workers=1', '--reporter=list', '--max-failures=1', '--global-timeout=360000',
      '--output', path.join('test-results', file.replace('.spec.ts', ''))], {cwd: root, stdio: 'inherit', windowsHide: true,
      env: {...process.env, FRAMECRAFT_DISABLE_GPU: '1', FRAMECRAFT_TEST_GPU: ''}});
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const clean = () => {process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);};
    child.once('error', error => {clean(); reject(error);});
    child.once('exit', code => {clean(); resolve(code ?? 1);});
  });
  if(code !== 0) {process.exitCode = code; break;}
}
