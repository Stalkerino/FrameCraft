import {constants} from 'node:fs';
import {access, copyFile, link, mkdir, readdir, realpath, symlink} from 'node:fs/promises';
import path from 'node:path';
import {RenderInternals} from '@remotion/renderer';

export const bundledRenderBinary = (type: 'ffmpeg' | 'ffprobe' | 'compositor') => RenderInternals.getExecutablePath({type, binariesDirectory: null, indent: false, logLevel: 'error'});

export async function resolveExecutable(command: string): Promise<string | undefined> {
  const names = process.platform === 'win32' && !path.extname(command) ? [command + '.exe', command] : [command];
  const directories = path.isAbsolute(command) || command.includes('/') || command.includes('\\') ? [''] : (process.env.PATH || '').split(path.delimiter).map(value => value.replace(/^"|"$/g, ''));
  for(const directory of directories) for(const name of names) {
    const file = path.resolve(directory, name);
    try {await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return await realpath(file);} catch { /* Try the next PATH entry. */ }
  }
}

/** Keep Remotion's compositor and its libraries; substitute only the encoding binary. */
export async function prepareRenderBinaries(workspace: string, ffmpeg: string): Promise<string | undefined> {
  if(ffmpeg === bundledRenderBinary('ffmpeg')) return undefined;
  const directory = path.join(workspace, 'binaries');
  await mkdir(directory, {recursive: true});
  const files = new Map<string, string>();
  const bundled = path.dirname(bundledRenderBinary('compositor'));
  for(const entry of await readdir(bundled, {withFileTypes: true})) {
    if(entry.isFile() || entry.isSymbolicLink()) files.set(entry.name, path.join(bundled, entry.name));
  }
  const filename = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  files.set(filename, ffmpeg);
  if(process.platform === 'win32') {
    // Shared Windows builds load their DLLs beside ffmpeg.exe. No admin symlinks.
    for(const entry of await readdir(path.dirname(ffmpeg), {withFileTypes: true})) {
      if(!entry.isFile() || !entry.name.toLowerCase().endsWith('.dll')) continue;
      if(files.has(entry.name)) throw new Error('This FFmpeg build has conflicting DLLs. Set FFMPEG_PATH to a standalone static FFmpeg build for GPU exports.');
      files.set(entry.name, path.join(path.dirname(ffmpeg), entry.name));
    }
  }
  for(const [name, source] of files) {
    const destination = path.join(directory, name);
    if(process.platform === 'win32') await link(source, destination).catch(() => copyFile(source, destination));
    else await symlink(source, destination, 'file');
  }
  return directory;
}
