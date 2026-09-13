import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {releaseEnvironment} = await import(new URL('../scripts/release/runtime.mjs', import.meta.url).href);
const {releaseVersion} = await import(new URL('../scripts/release/stage.mjs', import.meta.url).href);
const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});

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
