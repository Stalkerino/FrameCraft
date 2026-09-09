import {mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import path from 'node:path';

export async function createRenderWorkspace(cache: string) {
  await mkdir(cache, {recursive: true});
  const directory = await mkdtemp(path.join(cache, 'job-'));
  let alias: string | undefined;
  const dispose = async () => {
    // rm removes the symlink itself; only this job's generated files are removed.
    try {if(alias) await rm(alias, {recursive: true, force: true});}
    finally {await rm(directory, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});}
  };
  try {
    let temporary = directory;
    if(process.platform === 'linux') {
      // Chromium creates a Unix socket below TMPDIR. Long project paths exceed
      // its 108-byte limit. The alias is short; large files still live on disk.
      alias = await mkdtemp('/tmp/fc-');
      temporary = path.join(alias, 'work');
      await symlink(directory, temporary, 'dir');
    }
    return {directory, temporary, dispose};
  } catch(error) {await dispose(); throw error;}
}
