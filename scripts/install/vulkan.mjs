import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, rename, rm, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {root, runtime, run, mainModule} from './runtime.mjs';

/** Install a coherent FFmpeg/libplacebo build without replacing system or
 * compatibility-renderer binaries. No hardware initialization during setup.
 */
export async function installVulkan({archive: localArchive, shared = false} = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'shared/vulkan-runtime.json'), 'utf8'));
  const entry = (shared ? manifest.sharedPlatforms : manifest.platforms)[`${process.platform}-${process.arch}`];
  if(!entry) throw new Error('The packaged Vulkan runtime requires x64 Windows/Linux. Set FRAMECRAFT_VULKAN_FFMPEG for another build.');
  const parent = path.join(runtime, shared ? 'vulkan-shared' : 'vulkan');
  const destination = path.join(parent, manifest.release);
  const binary = path.join(destination, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {await access(binary); console.log(`Vulkan runtime ready: ${binary}`); return binary;} catch { /* Install the pinned version. */ }
  await mkdir(parent, {recursive: true});
  const scratch = await mkdtemp(path.join(parent, '.install-'));
  try {
    const archive = localArchive ? path.resolve(localArchive) : path.join(scratch, entry.archive);
    if(!localArchive) {
      console.log(`Downloading isolated Vulkan runtime: ${entry.archive}`);
      const response = await fetch(manifest.baseUrl + entry.archive, {signal: AbortSignal.timeout(180000)});
      if(!response.ok || !response.body) throw new Error(`Vulkan runtime download failed: HTTP ${response.status}. No existing runtime was changed.`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, {flags: 'wx'}));
    }
    const hash = createHash('sha256');
    for await(const chunk of createReadStream(archive)) hash.update(chunk);
    if(hash.digest('hex') !== entry.sha256) throw new Error('Vulkan runtime checksum mismatch; archive was not extracted.');
    const unpacked = path.join(scratch, 'unpacked'); await mkdir(unpacked);
    // bsdtar ships with supported Windows versions; Linux tar handles xz.
    await run('tar', ['-xf', archive, '-C', unpacked, '--strip-components=1'], {capture: true});
    const executable = path.join(unpacked, 'bin', path.basename(binary));
    if(!shared) console.log((await run(executable, ['-version'], {capture: true})).split('\n')[0]);
    await rename(unpacked, destination);
    console.log(`Vulkan runtime ready: ${binary}`);
    return binary;
  } finally {await rm(scratch, {recursive: true, force: true});}
}

if(mainModule(import.meta.url)) {
  const {values} = parseArgs({options: {archive: {type: 'string'}, shared: {type: 'boolean'}}});
  installVulkan(values).catch(error => {console.error(error.message); process.exitCode = 1;});
}
