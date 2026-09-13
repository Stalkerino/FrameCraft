import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = process.argv[2] === 'build';
// Source-checkout launcher. Packaging Node and the media libraries is a
// separate distribution step; a desktop development build is not an installer.
const child = spawn(process.execPath, build ? [path.join(root, 'scripts/build-desktop.mjs'), ...process.argv.slice(3)] : [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', windowsHide: false,
  env: {...process.env, FRAMECRAFT_ROOT: root, FRAMECRAFT_NODE: process.execPath, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '2'},
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill());
