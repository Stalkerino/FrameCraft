import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {root, run} from '../install/runtime.mjs';

export async function verifyPayload(app, env, log) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'Framecraft payload '));
  try {
    const metadata = JSON.parse(await readFile(path.join(app, 'release.json'), 'utf8'));
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const bin = path.join(app, '.runtime/vulkan', metadata.mediaRelease, 'bin');
    const fixture = path.join(scratch, 'probe.mp4');
    await run(path.join(bin, 'ffprobe' + suffix), ['-version'], {env, capture: true, log});
    await run(path.join(bin, 'ffmpeg' + suffix), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-filter_threads', '1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=1', '-frames:v', '1', '-an', '-c:v', 'mpeg4', '-threads', '1', fixture], {env, log});
    await run(path.join(app, 'runtime', 'node' + suffix), [path.join(root, 'scripts/release/payload-probe.mjs'), fixture], {cwd: app, env, log});
  } finally {await rm(scratch, {recursive: true, force: true});}
}
