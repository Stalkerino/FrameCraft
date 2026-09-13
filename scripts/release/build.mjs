import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {root, runtime, run, npmCli, readConfig} from '../install/runtime.mjs';
import {desktopBuildEnvironment, checkDesktopPrerequisites, prepareDesktopDependencies} from '../build/desktop-environment.mjs';
import {releaseDirectory, releaseVersion, stageRelease} from './stage.mjs';
import {framecraftAt} from '../install/editor-presence.mjs';

const version = releaseVersion(process.env.FRAMECRAFT_RELEASE_VERSION || JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
await mkdir(runtime, {recursive: true});
let env = desktopBuildEnvironment(await readConfig().catch(() => ({})));
const target = await checkDesktopPrerequisites(env);
if(await framecraftAt(`http://127.0.0.1:${env.PORT || 4318}`)) throw new Error('Close Framecraft before packaging this checkout; dependencies must not be replaced while editing.');
env = {...await prepareDesktopDependencies(env), FRAMECRAFT_RELEASE_BUILD: '1', CARGO_PROFILE_RELEASE_LTO: 'thin'};
await run(process.execPath, [await npmCli(), 'run', 'build'], {env});
const {app, libraries, names} = await stageRelease(version, env);
// Generate desktop icons from the existing vector identity, not a separate logo.
const icons = path.join(releaseDirectory, 'icons');
await run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', path.join(root, 'public/favicon.svg'), '--output', icons], {env});
const resources = {[app + path.sep]: 'app/'};
const linuxFiles = {};
for(const name of names) {
  if(process.platform === 'win32') resources[path.join(libraries, name)] = name;
  else linuxFiles[`/usr/lib/framecraft/${name}`] = path.join(libraries, name);
}
const config = {version, bundle: {active: true, category: 'Video', shortDescription: 'Video editing with local AI tools and native GPU rendering',
  icon: ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico'].map(name => path.join(icons, name)), resources,
  windows: {webviewInstallMode: {type: 'offlineInstaller', silent: true}, nsis: {installMode: 'currentUser', compression: 'lzma'}},
  linux: {deb: {files: linuxFiles, depends: ['libgtk-3-0', 'libwebkit2gtk-4.1-0', 'libvulkan1', 'libasound2', 'libatomic1']},
    appimage: {files: linuxFiles, bundleMediaFramework: true}}}};
const configFile = path.join(releaseDirectory, 'tauri.release.json');
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
await rm(path.join(env.CARGO_TARGET_DIR, target, 'release/bundle'), {recursive: true, force: true});
await run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--target', target, '--config', configFile,
  '--bundles', process.platform === 'win32' ? 'nsis' : 'appimage,deb', '--', '--locked'], {env});
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
