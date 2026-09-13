import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {root, environment, readConfig, installationCurrent, mainModule} from '../install/runtime.mjs';

import {framecraftAt} from '../install/editor-presence.mjs';
export {framecraftAt};
async function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
function openEditor(url) {
  const binary = process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(binary, args, {stdio: 'ignore', detached: true, windowsHide: true});
  child.on('error', () => console.log(`Open ${url} in your browser.`)); child.unref();
}
export async function launch({open = !process.argv.includes('--no-open')} = {}) {
  let env = environment(await readConfig().catch(() => ({})));
  const port = Number(env.PORT || 4318);
  if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const url = `http://127.0.0.1:${port}`;
  if(!await portAvailable(port)) {
    if(!await framecraftAt(url)) throw new Error(`Port ${port} is occupied by another application. Set PORT to a free port and try again.`);
    console.log(`Framecraft is already running at ${url}`); if(open) openEditor(url); return;
  }
  if(!await installationCurrent()) {
    console.log('Preparing or updating this installation...');
    const {setup} = await import('./setup.mjs'); await setup({start: false});
    env = environment(await readConfig());
  }
  console.log(`Starting Framecraft at ${url}\nKeep this window open. Ctrl+C stops the editor.`);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {cwd: root, env, stdio: 'inherit', windowsHide: true});
  let ended = false;
  const closed = new Promise((resolve, reject) => {
    child.once('error', error => {ended = true; reject(error);});
    child.once('exit', (code, signal) => {ended = true; code === 0 || signal === 'SIGTERM' || signal === 'SIGINT' ? resolve() : reject(new Error(`Framecraft stopped (${signal || code}).`));});
  });
  // Register a handler immediately while waiting for readiness to avoid unhandled rejection.
  closed.catch(() => {});
  const stop = () => {if(!ended) child.kill('SIGTERM');};
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    let ready = false;
    const deadline = Date.now() + 45000;
    while(!ended && Date.now() < deadline) {
      if(await framecraftAt(url)) {ready = true; break;}
      await delay(300);
    }
    if(ready) {if(open) openEditor(url);}
    else if(!ended) {stop(); throw new Error(`The editor did not become ready at ${url}. Check the server error above.`);}
    await closed;
  } finally {stop(); process.off('SIGINT', stop); process.off('SIGTERM', stop);}
}
if(mainModule(import.meta.url)) launch().catch(error => {console.error(`\nCannot start Framecraft: ${error.message}`); process.exitCode = 1;});
