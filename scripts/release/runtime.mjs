import {existsSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

/** Installed application resources are immutable. All mutable state lives in user data. */
export async function releaseEnvironment(root, inherited = process.env) {
  if(!existsSync(path.join(root, 'release.json'))) return inherited;
  if(!inherited.FRAMECRAFT_DATA_DIR) throw new Error('The installed app requires its desktop user-data directory.');
  const metadata = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'));
  const data = path.resolve(inherited.FRAMECRAFT_DATA_DIR);
  const workspace = inherited.FRAMECRAFT_AGENT_WORKSPACE || path.join(path.dirname(data), 'workspace');
  const bin = path.join(root, '.runtime/vulkan', metadata.mediaRelease, 'bin');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const env = {...inherited, FRAMECRAFT_DATA_DIR: data,
    FRAMECRAFT_LIBRARY_DIR: inherited.FRAMECRAFT_LIBRARY_DIR || path.join(data, 'asset-library'),
    FRAMECRAFT_MODEL_CACHE: inherited.FRAMECRAFT_MODEL_CACHE || path.join(data, 'cache/models'),
    FRAMECRAFT_BROWSER_CACHE: inherited.FRAMECRAFT_BROWSER_CACHE || path.join(data, 'cache/browser'),
    FRAMECRAFT_AGENT_WORKSPACE: workspace,
    ...(process.platform === 'linux' ? {FRAMECRAFT_FONT_DIR: path.join(root, 'runtime/fonts')} : {}),
    FFMPEG_PATH: path.join(bin, 'ffmpeg' + suffix), FFPROBE_PATH: path.join(bin, 'ffprobe' + suffix),
    FRAMECRAFT_VULKAN_FFMPEG: path.join(bin, 'ffmpeg' + suffix),
    PATH: [path.join(root, 'runtime'), bin, inherited.PATH || inherited.Path || ''].join(path.delimiter)};
  if(process.platform === 'win32') for(const key of Object.keys(env)) if(key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
  await Promise.all([data, workspace, env.FRAMECRAFT_LIBRARY_DIR, env.FRAMECRAFT_MODEL_CACHE].map(dir => mkdir(dir, {recursive: true})));
  return env;
}
