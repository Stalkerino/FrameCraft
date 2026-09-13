import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import path from 'node:path';
import {root, runtime, run, npmCli, readConfig} from '../install/runtime.mjs';
import {desktopBuildEnvironment, checkDesktopPrerequisites, prepareDesktopDependencies} from '../build/desktop-environment.mjs';
import {releaseDirectory, releaseVersion, stageRelease} from './stage.mjs';
import {framecraftAt} from '../install/editor-presence.mjs';
import {packageConfig} from './package-config.mjs';
import {verifyPayload} from './verify-payload.mjs';

const version = releaseVersion(process.env.FRAMECRAFT_RELEASE_VERSION || JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
await mkdir(runtime, {recursive: true});
let env = desktopBuildEnvironment(await readConfig().catch(() => ({})));
const target = await checkDesktopPrerequisites(env);
if(await framecraftAt(`http://127.0.0.1:${env.PORT || 4318}`)) throw new Error('Close Framecraft before packaging this checkout; dependencies must not be replaced while editing.');
env = {...await prepareDesktopDependencies(env), FRAMECRAFT_RELEASE_BUILD: '1'};
await run(process.execPath, [await npmCli(), 'run', 'build'], {env});
const {app, libraries, names} = await stageRelease(version, env);
// Generate desktop icons from the existing vector identity, not a separate logo.
const icons = path.join(releaseDirectory, 'icons');
await run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', path.join(root, 'public/favicon.svg'), '--output', icons], {env});
const config = packageConfig({version, app, libraries, names, icons, root});
const configFile = path.join(releaseDirectory, 'tauri.release.json');
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
await rm(path.join(env.CARGO_TARGET_DIR, target, 'release/bundle'), {recursive: true, force: true});
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const log = createWriteStream(path.join(releaseDirectory, 'packaging.log'));
try {
  console.log('Checking bundled runtime before Rust compilation…');
  await verifyPayload(app, env, log);
  console.log('Compiling optimized desktop application…');
  await run(process.execPath, [cli, 'build', '--no-bundle', '--target', target, '--config', configFile, '--', '--locked'], {env, log});
  // Separate packaging from compilation: verbose output exposes linuxdeploy's
  // stderr, which Tauri otherwise replaces with a generic error message.
  for(const bundle of process.platform === 'win32' ? ['nsis'] : ['deb', 'appimage']) {
    console.log(`Packaging ${bundle} (no Rust compilation)…`);
    const started = Date.now();
    // Cargo already strips the application. Preserve prebuilt Node/media ELF
    // files: the runner's older binutils may not understand their sections.
    await run(process.execPath, [cli, 'bundle', '--verbose', '--target', target, '--config', configFile, '--bundles', bundle],
      {env: process.platform === 'linux' ? {...env, NO_STRIP: '1', APPIMAGE_EXTRACT_AND_RUN: '1'} : env, log});
    console.log(`${bundle} packaged in ${Math.round((Date.now() - started) / 1000)}s.`);
  }
} finally {log.end(); await finished(log);}
const output = path.join(releaseDirectory, 'artifacts'); await mkdir(output);
const bundleRoot = path.join(env.CARGO_TARGET_DIR, target, 'release/bundle');
let count = 0;
async function collect(directory) {
  for(const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if(entry.isDirectory()) await collect(file);
    else if(/(?:-setup\.exe|\.AppImage|\.deb)$/.test(entry.name)) {
      await cp(file, path.join(output, entry.name)); count++;
    }
  }
}
await collect(bundleRoot);
if(count !== (process.platform === 'win32' ? 1 : 2)) throw new Error(`Expected installers were not produced (found ${count}).`);
console.log(`Release ${version} packages ready in ${output}`);
