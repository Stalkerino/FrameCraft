import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveBrowserPath} from './browser-path.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runtime = path.join(root, '.runtime');
export function environment(config = {}) {
  const env = {...process.env, SHARP_IGNORE_GLOBAL_LIBVIPS: process.env.SHARP_IGNORE_GLOBAL_LIBVIPS ?? '1'};
  env.PATH = [path.dirname(process.execPath), path.join(runtime, 'ffmpeg/bin'), env.PATH || env.Path || ''].join(path.delimiter);
  // Windows treats environment keys case-insensitively; pass only one PATH key.
  if(process.platform === 'win32') for(const key of Object.keys(env)) if(key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
  for(const key of ['FFMPEG_PATH', 'FFPROBE_PATH']) if(!env[key] && config[key]) env[key] = path.resolve(root, config[key]);
  const browser = resolveBrowserPath({root, env, configured: config.CHROME_PATH});
  // An invalid inherited override must not replace the repaired saved path.
  for(const key of Object.keys(env)) if(key.toUpperCase() === 'CHROME_PATH') delete env[key];
  if(browser) env.CHROME_PATH = browser;
  return env;
}
export async function readConfig() {return JSON.parse(await readFile(path.join(runtime, 'config.json'), 'utf8'));}
export function run(binary, args, {env = environment(), capture = false, log, cwd = root} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {cwd, env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe']});
    let output = '';
    for(const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', chunk => {
      if(capture) output = (output + chunk.toString()).slice(-2_000_000); else target.write(chunk);
      log?.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve(output) : reject(new Error(`${path.basename(binary)} ${args[0] ?? ''} failed (${signal || code}).${capture ? '\n' + output.slice(-2000) : ' See the output above.'}`)));
  });
}
export function findExecutable(name, env = environment()) {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for(const directory of (env.PATH || '').split(path.delimiter)) for(const extension of extensions) {
    const file = path.join(directory.replace(/^"|"$/g, ''), name + extension);
    if(existsSync(file)) return file;
  }
}
export async function npmCli() {
  const bin = path.dirname(process.execPath);
  const candidates = [path.join(bin, 'node_modules/npm/bin/npm-cli.js'), path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js')];
  const npm = findExecutable('npm');
  if(npm && !npm.endsWith('.cmd')) candidates.push(await realpath(npm));
  const found = candidates.find(file => existsSync(file) && file.endsWith('.js'));
  if(!found) throw new Error('npm is missing from this Node installation. Install Node with npm, or remove the incomplete .runtime/node folder and rerun setup.');
  return found;
}
export async function fingerprint() {
  const hash = createHash('sha256');
  const walk = async directory => {
    for(const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if(entry.isDirectory()) await walk(file);
      else if(entry.isFile()) {hash.update(path.relative(root, file).split(path.sep).join('/')); hash.update(await readFile(file));}
    }
  };
  for(const directory of ['src', 'server', 'shared', 'scripts/install', 'scripts/web']) await walk(path.join(root, directory));
  for(const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']) hash.update(await readFile(path.join(root, file)));
  hash.update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`);
  return hash.digest('hex');
}
export async function installationCurrent() {
  try {
    await readConfig();
    const state = JSON.parse(await readFile(path.join(runtime, 'installed.json'), 'utf8'));
    return state.fingerprint === await fingerprint() && existsSync(path.join(root, 'node_modules/tsx')) && (await stat(path.join(root, 'dist/index.html'))).isFile();
  } catch {return false;}
}
export function desktopQuote(value) {
  // Desktop Entry Exec quoting has its own escaping rules, independent of shells.
  return '"' + value.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%') + '"';
}
export function mainModule(url) {return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);}
