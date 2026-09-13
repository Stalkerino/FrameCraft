import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4318);
if(!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Framecraft backend port.');
const url = `http://127.0.0.1:${port}`;
let child; let closing = false;
const status = async () => {
  try {const response = await fetch(`${url}/api/status`, {signal: AbortSignal.timeout(500)}); if(!response.ok) throw new Error('This port belongs to another service.'); return await response.json();}
  catch(error) {if(error.cause?.code === 'ECONNREFUSED') return undefined; throw error;}
};
const verify = value => {
  const data = path.resolve(process.env.FRAMECRAFT_DATA_DIR || path.join(root, 'data'));
  if(path.resolve(value.rootDir || '.') !== root || !value.projectPath || !path.resolve(value.projectPath).startsWith(data + path.sep)) throw new Error('Another Framecraft workspace owns this port. Close it or select the matching PORT and data directory.');
};
const close = () => {
  if(closing) return; closing = true;
  if(child?.connected) {
    child.send({type: 'desktop-shutdown'}, error => {if(error) child.kill();});
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
  } else if(child) child.kill();
  else process.exit(Number(process.exitCode ?? 0));
};
createInterface({input: process.stdin}).on('line', line => {if(line === 'shutdown') close();}).on('close', close);
process.on('SIGINT', close); process.on('SIGTERM', close);
try {
  const existing = await status();
  if(existing) verify(existing);
  else {
    child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'server/index.ts')], {cwd: root, windowsHide: true,
      env: {...process.env, FRAMECRAFT_HOST: '127.0.0.1', PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
    child.on('error', error => {console.error(error.message); process.exitCode = 1; close();});
    child.on('exit', code => {process.exit(code ?? 1);});
    let ready = false;
    for(let i = 0; i < 100 && !closing; i++) {
      const value = await status();
      if(value) {verify(value); ready = true; break;}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if(!ready) throw new Error('The editor backend did not start within ten seconds.');
  }
  if(!closing) process.stdout.write(JSON.stringify({event: 'ready', url, ownsBackend: !!child}) + '\n');
} catch(error) {console.error(error.message); process.exitCode = 1; close();}
