import {createWriteStream} from 'node:fs';
import {access, mkdir, mkdtemp, rm, rename, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {runtime, run, mainModule} from './runtime.mjs';
import {installVulkan} from './vulkan.mjs';

export async function prepareDesktopSdk() {
await installVulkan({shared: true});
const parent = path.join(runtime, 'vulkan-headers'); const destination = path.join(parent, '1.4.341');
try {await access(path.join(destination, 'include/vulkan/vulkan.h'));}
catch {
  await mkdir(parent, {recursive: true}); const scratch = await mkdtemp(path.join(parent, '.install-'));
  try {
    const response = await fetch('https://github.com/KhronosGroup/Vulkan-Headers/archive/refs/tags/v1.4.341.tar.gz', {signal: AbortSignal.timeout(60000)});
    if(!response.ok || !response.body) throw new Error(`Vulkan headers download failed: ${response.status}`);
    const archive = path.join(scratch, 'headers.tar.gz'); await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, {flags: 'wx'}));
    if(createHash('sha256').update(await readFile(archive)).digest('hex') !== '8876aad926b2e72bdefddc34885472d5332e2d20aa3ed57313466f0bc982cf3f') throw new Error('Vulkan header checksum mismatch');
    const unpacked = path.join(scratch, 'unpacked'); await mkdir(unpacked);
    await run('tar', ['-xf', archive, '-C', unpacked, '--strip-components=1'], {capture: true}); await rename(unpacked, destination);
  } finally {await rm(scratch, {recursive: true, force: true});}
}
console.log('Desktop media libraries and Vulkan headers ready. No GPU was initialized.');
}
if(mainModule(import.meta.url)) prepareDesktopSdk().catch(error => {console.error(error.message); process.exitCode = 1;});
