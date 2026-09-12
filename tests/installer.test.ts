import {afterEach, expect, it, vi} from 'vitest';
// Installer entry points are plain Node so they also run before npm ci.
// @ts-expect-error Plain bootstrap JavaScript intentionally has no TS dependency.
import {desktopQuote, environment, npmCli, fingerprint, root} from '../scripts/install/runtime.mjs';
// @ts-expect-error Plain bootstrap JavaScript intentionally has no TS dependency.
import {framecraftAt} from '../scripts/install/launch.mjs';
import path from 'node:path';
import {existsSync} from 'node:fs';
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

it('resolves local dependencies without changing the global process environment', () => {
  vi.stubEnv('FFMPEG_PATH', '/custom/ffmpeg');
  vi.stubEnv('FFPROBE_PATH', '');
  const before = {...process.env};
  const env = environment({FFMPEG_PATH: '.runtime/ffmpeg/bin/ffmpeg', FFPROBE_PATH: '.runtime/ffmpeg/bin/ffprobe'});
  expect(env.FFMPEG_PATH).toBe('/custom/ffmpeg');
  expect(env.FFPROBE_PATH).toBe(path.resolve(root, '.runtime/ffmpeg/bin/ffprobe'));
  expect(env.PATH.split(path.delimiter)[0]).toBe(path.dirname(process.execPath));
  expect(process.env).toEqual(before);
});
it('uses npm through its JS entry point instead of a Windows shell command', async () => {
  const npm = await npmCli(); expect(npm.endsWith('.js')).toBe(true); expect(existsSync(npm)).toBe(true);
});
it('fingerprints a reproducible installation and quotes desktop arguments', async () => {
  expect(await fingerprint()).toMatch(/^[a-f0-9]{64}$/);
  expect(desktopQuote('/a path/100%/"$x`')).toBe('"/a path/100%%/\\"\\$x\\`"');
});
it('opens an occupied port only when the service responds like Framecraft', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValueOnce(Response.json({project: {version: 1, id: 'project', clips: [], tracks: []}}));
  expect(await framecraftAt('http://127.0.0.1:4318')).toBe(true);
  fetchMock.mockResolvedValueOnce(Response.json({service: 'another-app'}));
  expect(await framecraftAt('http://127.0.0.1:4318')).toBe(false);
  fetchMock.mockRejectedValueOnce(new Error('Disconnected'));
  expect(await framecraftAt('http://127.0.0.1:4318')).toBe(false);
});
