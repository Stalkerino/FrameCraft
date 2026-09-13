import {realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import type {RenderJob} from '../../shared/project';

/** Resolve only a completed render owned by this server, never a client path. */
export async function resolveRenderOutput(job: RenderJob | undefined, directory: string) {
  if(!job) throw Object.assign(new Error('Render job not found'), {status: 404});
  if(job.status !== 'done' || !job.url) throw Object.assign(new Error('This export is not ready to open.'), {status: 409});
  if(job.outputPath && job.url === `/api/render/${job.id}/file` && path.isAbsolute(job.outputPath)) {
    try {
      const file = await realpath(job.outputPath);
      if(!(await stat(file)).isFile()) throw new Error('Invalid export file');
      return {path: file};
    } catch {throw Object.assign(new Error('The exported file is no longer available on disk.'), {status: 404});}
  }
  const filename = job.url.slice('/exports/'.length);
  if(!job.url.startsWith('/exports/') || !filename || /[/\\]/.test(filename)) throw new Error('Invalid export filename');
  try {
    const root = await realpath(directory);
    const file = await realpath(path.join(root, filename));
    if(path.dirname(file) !== root || !(await stat(file)).isFile()) throw new Error('Invalid export file');
    return {path: file};
  } catch {
    throw Object.assign(new Error('The exported file is no longer available on disk.'), {status: 404});
  }
}
