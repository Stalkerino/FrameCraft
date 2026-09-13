import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, stat, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {releaseEnvironment} = await import(new URL('../scripts/release/runtime.mjs', import.meta.url).href);
const {releaseVersion} = await import(new URL('../scripts/release/stage.mjs', import.meta.url).href);
const {trimOnnxPlatforms} = await import(new URL('../scripts/release/native-payload.mjs', import.meta.url).href);
const {packageConfig} = await import(new URL('../scripts/release/package-config.mjs', import.meta.url).href);
const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});

it('keeps private Linux runtimes outside the AppImage ELF scan in both package formats', () => {
  const config = packageConfig({platform: 'linux', version: '1.2.3', root: '/repo', app: '/stage/app', libraries: '/stage/libraries', icons: '/icons', names: ['libavcodec.so.62']});
  expect(config.bundle.resources).toEqual({});
  for(const format of ['deb', 'appimage']) {
    const files = config.bundle.linux[format].files;
    expect(files['/usr/share/framecraft/app']).toBe('/stage/app');
    expect(files['/usr/lib/framecraft/libavcodec.so.62']).toBe('/stage/libraries/libavcodec.so.62');
    expect(Object.entries(files).filter(([target, source]) => target.startsWith('/usr/lib/') && source === '/stage/app')).toEqual([]);
  }
});

it('retains Windows resources and DLLs beside the EXE with offline installation', () => {
  const config = packageConfig({platform: 'win32', version: '1.2.3', root: 'C:\\repo', app: 'C:\\stage\\app', libraries: 'C:\\stage\\libraries', icons: 'C:\\icons', names: ['avcodec-62.dll']});
  expect(config.bundle.resources).toEqual({'C:\\stage\\app\\': 'app/', 'C:\\stage\\libraries\\avcodec-62.dll': 'avcodec-62.dll'});
  expect(config.bundle.windows.webviewInstallMode.type).toBe('offlineInstaller');
});

it('keeps packaged user data, AI workspace and media tools outside installation writes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-release-')); directories.push(directory);
  const app = path.join(directory, 'Read only app'); await mkdir(app);
  await writeFile(path.join(app, 'release.json'), JSON.stringify({mediaRelease: 'pinned-sdk'}));
  const original = {PATH: '/existing/tools', FRAMECRAFT_DATA_DIR: path.join(directory, 'User data', 'data'), FFMPEG_PATH: '/old/missing/ffmpeg'};
  const env = await releaseEnvironment(app, original);
  expect(env.FFMPEG_PATH).toBe(path.join(app, '.runtime/vulkan/pinned-sdk/bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  expect(env.FRAMECRAFT_LIBRARY_DIR).toBe(path.join(original.FRAMECRAFT_DATA_DIR, 'asset-library'));
  expect(env.FRAMECRAFT_BROWSER_CACHE).toBe(path.join(original.FRAMECRAFT_DATA_DIR, 'cache/browser'));
  expect(env.FRAMECRAFT_AGENT_WORKSPACE).toBe(path.join(directory, 'User data/workspace'));
  expect((await stat(env.FRAMECRAFT_AGENT_WORKSPACE)).isDirectory()).toBe(true);
  expect(original.FFMPEG_PATH).toBe('/old/missing/ffmpeg');
  await expect(releaseEnvironment(app, {})).rejects.toThrow('user-data directory');
});

it('preserves checkout startup and rejects unsafe release versions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-checkout-')); directories.push(directory);
  const env = {FRAMECRAFT_DATA_DIR: 'custom'};
  expect(await releaseEnvironment(directory, env)).toBe(env);
  expect(releaseVersion('v1.2.3-beta.1')).toBe('1.2.3-beta.1');
  for(const invalid of ['../release', 'refs/heads/main', '01.2.3', '1.2', '1.2.3\nmalformed']) expect(() => releaseVersion(invalid)).toThrow();
});

it.each(['linux', 'win32'])('packages only %s host ONNX binaries and preserves its binding and license', async platform => {
  const app = await mkdtemp(path.join(tmpdir(), 'framecraft-payload-')); directories.push(app);
  const onnx = path.join(app, 'node_modules/onnxruntime-node');
  const binaries = path.join(onnx, 'bin/napi-v3');
  for(const os of ['linux', 'win32', 'darwin']) for(const arch of ['x64', 'arm64']) {
    const directory = path.join(binaries, os, arch); await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, 'onnxruntime_binding.node'), `${os}/${arch}`);
  }
  await writeFile(path.join(onnx, 'LICENSE'), 'retained');
  await trimOnnxPlatforms(app, platform, 'x64');
  expect(await readdir(binaries)).toEqual([platform]);
  expect(await readdir(path.join(binaries, platform))).toEqual(['x64']);
  expect(await readFile(path.join(binaries, platform, 'x64/onnxruntime_binding.node'), 'utf8')).toBe(`${platform}/x64`);
  expect(await readFile(path.join(onnx, 'LICENSE'), 'utf8')).toBe('retained');
  const missing = platform === 'linux' ? 'win32' : 'linux';
  await expect(trimOnnxPlatforms(app, missing, 'x64')).rejects.toThrow();
  expect(await readdir(binaries)).toEqual([platform]);
});
