import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {cwd: root, stdio: 'inherit'}),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {cwd: root, stdio: 'inherit'}),
];
let closing = false;
const close = (code = 0) => {if (closing) return; closing = true; children.forEach(child => child.kill()); process.exitCode = code;};
children.forEach(child => {child.on('error', error => {console.error(error); close(1);}); child.on('exit', code => close(code ?? 0));});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
