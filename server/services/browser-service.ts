import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {rootDir} from '../config';

export const browserExecutable = () => process.env.CHROME_PATH || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

/** Only compatibility rendering needs Chrome. Download into writable user cache,
 * never Program Files, the AppImage mount, or application node_modules. */
export async function prepareRenderBrowser() {
  if(!process.env.FRAMECRAFT_BROWSER_CACHE) return;
  const current = browserExecutable();
  if(current && existsSync(current)) return;
  const {stdout} = await promisify(execFile)(process.execPath, [path.join(rootDir, 'scripts/install/browser.mjs'), '--prepare'],
    {windowsHide: true, timeout: 600000, maxBuffer: 2_000_000});
  const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
  if(typeof result.path !== 'string' || !existsSync(result.path)) throw new Error('Compatibility browser preparation failed.');
  process.env.CHROME_PATH = result.path;
}
