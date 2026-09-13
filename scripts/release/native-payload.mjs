import {access, readdir, rm} from 'node:fs/promises';
import path from 'node:path';

// ONNX ships several platforms in one npm package. linuxdeploy recursively
// inspects ELF files in resources, including otherwise unused ARM libraries.
// Only trim the isolated staging tree; keep all host bindings and licenses.
export async function trimOnnxPlatforms(app, platform = process.platform, arch = process.arch) {
  if(!['linux', 'win32'].includes(platform) || arch !== 'x64') throw new Error('Unsupported release platform.');
  const binaries = path.join(app, 'node_modules/onnxruntime-node/bin/napi-v3');
  await access(path.join(binaries, platform, arch, 'onnxruntime_binding.node'));
  for(const entry of await readdir(binaries, {withFileTypes: true})) {
    if(!entry.isDirectory()) continue;
    const directory = path.join(binaries, entry.name);
    if(entry.name !== platform) await rm(directory, {recursive: true});
    else for(const architecture of await readdir(directory, {withFileTypes: true})) {
      if(architecture.isDirectory() && architecture.name !== arch) await rm(path.join(directory, architecture.name), {recursive: true});
    }
  }
}
