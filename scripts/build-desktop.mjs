import {createWriteStream} from 'node:fs';
import {mkdir, stat, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {root, runtime, run, npmCli, readConfig, mainModule} from './install/runtime.mjs';
import {framecraftAt} from './install/editor-presence.mjs';
import {checkDesktopPrerequisites, desktopBuildEnvironment, desktopBinary, nativeBuildArgs, prepareDesktopDependencies} from './build/desktop-environment.mjs';

export async function buildDesktop({debug = false, check = false, launch = false} = {}) {
  let env = desktopBuildEnvironment(await readConfig().catch(() => ({})));
  if(check) {await checkDesktopPrerequisites(env); console.log('Build prerequisites found. No downloads, compilation or GPU checks were run.'); return;}
  await mkdir(runtime, {recursive: true}); const logPath = path.join(runtime, 'desktop-build.log');
  const log = createWriteStream(logPath, {flags: 'a'});
  log.write(`\nDesktop build ${new Date().toISOString()} ${process.platform}/${process.arch}\n`);
  try {
    const target = await checkDesktopPrerequisites(env, log);
    // npm ci replaces dependencies; never rebuild beneath a running editor.
    if(await framecraftAt(`http://127.0.0.1:${env.PORT || 4318}`)) throw new Error('Close Framecraft before building this checkout. The build will not stop your running editor.');
    env = await prepareDesktopDependencies(env, log);
    console.log('Building the editor interface…');
    await run(process.execPath, [await npmCli(), 'run', 'build'], {env, log});
    console.log('Building the native desktop application. The first Rust build can take several minutes…');
    await run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...nativeBuildArgs(target, debug)], {env, log});
    const executable = desktopBinary(env.CARGO_TARGET_DIR, target, debug);
    if(!(await stat(executable)).isFile()) throw new Error(`Build output was not found: ${executable}`);
    await writeFile(path.join(runtime, 'desktop-build.json'), JSON.stringify({platform: process.platform, arch: process.arch, target, profile: debug ? 'debug' : 'release', executable: path.relative(root, executable), builtAt: new Date().toISOString()}, null, 2) + '\n');
    console.log(`\nDesktop build ready:\n${executable}\nLaunch: ${process.platform === 'win32' ? 'Start-Desktop-Windows.cmd' : 'sh Start-Desktop-Linux.sh'} or npm run desktop:start\nKeep this checkout and .runtime folder; this build is not a standalone installer.\nLog: ${logPath}`);
  } catch(error) {log.write(`ERROR: ${error.stack ?? error}\n`); throw error;}
  finally {const finished = once(log, 'finish'); log.end(); await finished;}
  if(launch) {const {launchDesktop} = await import('./start-desktop.mjs'); await launchDesktop();}
}
if(mainModule(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {debug: {type: 'boolean'}, check: {type: 'boolean'}, launch: {type: 'boolean'}, help: {type: 'boolean'}}});
    if(values.help) console.log('Build Framecraft on this Windows/Linux x64 host:\n  npm run desktop:build [-- --debug] [-- --launch]\n  npm run desktop:build -- --check\nRequires Node 22+, Rust, and Tauri platform build tools. Installs locked npm dependencies and pinned media SDKs automatically. One compiler job by default; no tests or GPU probes.\nBuild separately on each OS. Output remains attached to this checkout.');
    else await buildDesktop(values);
  } catch(error) {console.error(`\nDesktop build failed: ${error.message}\nLog (if compilation started): ${path.join(runtime, 'desktop-build.log')}`); process.exitCode = 1;}
}
