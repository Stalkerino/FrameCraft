import {existsSync} from 'node:fs';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {root, runtime, environment, readConfig, run, npmCli, findExecutable} from '../install/runtime.mjs';
import {installVulkan} from '../install/vulkan.mjs';
import {prepareDesktopSdk} from '../install/desktop.mjs';
import {prepareBrowser} from '../install/browser.mjs';

const prerequisites = 'Install Rust (https://rustup.rs) and the platform build tools: https://v2.tauri.app/start/prerequisites/';
export function desktopBuildEnvironment(config = {}) {
  const env = environment(config);
  env.PATH = [path.join(process.env.CARGO_HOME || path.join(homedir(), '.cargo'), 'bin'), env.PATH].join(path.delimiter);
  return {...env, FRAMECRAFT_ROOT: root, FRAMECRAFT_NODE: process.execPath,
    CARGO_TARGET_DIR: path.resolve(root, env.CARGO_TARGET_DIR || 'src-tauri/target'),
    CARGO_BUILD_JOBS: env.CARGO_BUILD_JOBS || '1',
    // Optimized test builds, without the costly parallel thin-LTO link stage.
    CARGO_PROFILE_RELEASE_LTO: env.CARGO_PROFILE_RELEASE_LTO || 'off'};
}
export function desktopBinary(targetDirectory, target, debug, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return paths.join(targetDirectory, target, debug ? 'debug' : 'release', `framecraft-desktop${platform === 'win32' ? '.exe' : ''}`);
}
export function nativeBuildArgs(target, debug = false) {return ['build', '--no-bundle', '--target', target, ...(debug ? ['--debug'] : []), '--', '--locked'];}

export async function checkDesktopPrerequisites(env, log) {
  if(!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new Error('This desktop SDK supports Windows x64 and Linux x64. Run the build separately on each OS.');
  if(Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ with npm is required.');
  await npmCli();
  const cargo = findExecutable('cargo', env); const rustc = findExecutable('rustc', env);
  if(!cargo || !rustc) throw new Error(`Rust/Cargo was not found. ${prerequisites}`);
  const rust = await run(rustc, ['-vV'], {env, capture: true, log});
  const target = /^host:\s*(\S+)$/m.exec(rust)?.[1];
  if(!target || (process.platform === 'win32' ? target !== 'x86_64-pc-windows-msvc' : target !== 'x86_64-unknown-linux-gnu')) throw new Error(`Unsupported Rust host: ${target || 'unknown'}. Use x64 MSVC on Windows or x64 GNU on Linux. ${prerequisites}`);
  if(env.CARGO_BUILD_TARGET && env.CARGO_BUILD_TARGET !== target) throw new Error('Cross-compilation is not supported by the bundled media SDK. Remove CARGO_BUILD_TARGET and build on the destination OS.');
  if(process.platform === 'linux') {
    for(const tool of ['cc', 'pkg-config', 'tar']) if(!findExecutable(tool, env)) throw new Error(`Missing ${tool}. Install your distribution’s C/C++ build tools and pkg-config. ${prerequisites}`);
    try {await run(findExecutable('pkg-config', env), ['--exists', 'gtk+-3.0', 'webkit2gtk-4.1'], {env, capture: true, log});}
    catch {throw new Error(`GTK 3 / WebKitGTK 4.1 development libraries are missing. ${prerequisites}`);}
  } else {
    if(!findExecutable('tar', env)) throw new Error('Windows tar.exe is required to extract the media SDK. Use Windows 10/11 with the system tar tool available.');
    const programFiles = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhere = path.join(programFiles, 'Microsoft Visual Studio/Installer/vswhere.exe');
    let visualStudio = !!env.VCINSTALLDIR || !!env.VCToolsInstallDir;
    if(!visualStudio && existsSync(vswhere)) visualStudio = !!(await run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], {env, capture: true, log})).trim();
    const sdk = path.join(env.WindowsSdkDir || path.join(programFiles, 'Windows Kits/10'), 'Include');
    const sdkVersions = await readdir(sdk).catch(() => []);
    if(!visualStudio || !sdkVersions.some(version => existsSync(path.join(sdk, version, 'um/windows.h')))) throw new Error(`Install Visual Studio Build Tools with Desktop development with C++ and a Windows 10/11 SDK, then rerun the build. ${prerequisites}`);
  }
  console.log(`Native target: ${target}. Compiler jobs: ${env.CARGO_BUILD_JOBS}.`);
  return target;
}

export async function prepareDesktopDependencies(env, log) {
  const fingerprint = createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).update(await readFile(path.join(root, 'package.json'))).update(`${process.platform}/${process.arch}/${process.versions.node}`).digest('hex');
  const stamp = path.join(runtime, 'desktop-dependencies.json');
  const previous = await readFile(stamp, 'utf8').then(JSON.parse).catch(() => null);
  if(previous?.fingerprint !== fingerprint || !existsSync(path.join(root, 'node_modules/@tauri-apps/cli/tauri.js')) || !existsSync(path.join(root, 'node_modules/tsx/package.json'))) {
    console.log('Installing locked application dependencies…');
    await run(process.execPath, [await npmCli(), 'ci', '--include=dev', '--no-audit', '--no-fund'], {env, log});
    await writeFile(stamp, JSON.stringify({fingerprint}) + '\n');
  } else console.log('Locked application dependencies already prepared.');
  await prepareDesktopSdk();
  const ffmpeg = await installVulkan();
  const config = await readConfig().catch(() => ({}));
  const stored = file => {const relative = path.relative(root, file); return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative;};
  for(const [key, name] of [['FFMPEG_PATH', 'ffmpeg'], ['FFPROBE_PATH', 'ffprobe']]) {
    const existing = env[key] || (config[key] && path.resolve(root, config[key]));
    const binary = existing && existsSync(existing) ? existing : path.join(path.dirname(ffmpeg), name + (process.platform === 'win32' ? '.exe' : ''));
    if(!existsSync(binary)) throw new Error(`Missing media executable: ${binary}`);
    config[key] = stored(binary);
  }
  console.log('Preparing compatibility browser (download only; no GPU initialization)…');
  const browser = await prepareBrowser({env, config, log});
  config.CHROME_PATH = stored(browser);
  await writeFile(path.join(runtime, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  return desktopBuildEnvironment(config);
}
