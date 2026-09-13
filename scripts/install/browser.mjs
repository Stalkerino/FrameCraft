import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {root, runtime, run, mainModule} from './runtime.mjs';
import {resolveBrowserPath} from './browser-path.mjs';

export async function prepareBrowser({env, config = {}, log} = {}) {
  const cache = path.join(runtime, 'browser'); const record = path.join(cache, 'browser.json');
  const saved = await readFile(record, 'utf8').then(JSON.parse).catch(() => null);
  const browserExecutable = resolveBrowserPath({root, env, configured: config.CHROME_PATH, cached: saved?.path});
  if(browserExecutable) {console.log(`Rendering browser: ${browserExecutable}`); return browserExecutable;}
  console.log('No valid local browser found. Downloading managed Chrome Headless Shell…');
  await mkdir(cache, {recursive: true});
  // Remotion roots its downloads at the nearest package.json. Keep that cache
  // out of the application's node_modules, which npm ci replaces.
  await writeFile(path.join(cache, 'package.json'), '{"name":"framecraft-browser-cache","private":true}\n');
  try {await run(process.execPath, [path.join(root, 'scripts/install/browser.mjs'), '--download', record], {env, cwd: cache, log});}
  catch(error) {throw new Error(`Rendering browser download failed. ${error.message} Install Chrome/Edge or set CHROME_PATH to an existing executable, then retry.`);}
  const result = JSON.parse(await readFile(record, 'utf8'));
  if(!(await stat(result.path).catch(() => null))?.isFile()) throw new Error('Downloaded browser executable was not found. Retry the build; see the download error in its log.');
  return result.path;
}

if(mainModule(import.meta.url) && process.argv[2] === '--download') {
  try {
    const {ensureBrowser} = await import('@remotion/renderer');
    const browser = await ensureBrowser({browserExecutable: null, logLevel: 'info'});
    if(!('path' in browser) || !(await stat(browser.path)).isFile()) throw new Error('Chrome Headless Shell download did not produce an executable.');
    await writeFile(process.argv[3], JSON.stringify({path: browser.path}) + '\n');
  } catch(error) {console.error(error.message); process.exitCode = 1;}
}
