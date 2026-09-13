import path from 'node:path';
import {run} from '../install/runtime.mjs';

export async function prepareLinuxLibraries(directory, names, {env = process.env, patchelf = 'patchelf', log} = {}) {
  // The SDK normally inherits RPATH from its executable. linuxdeploy inspects
  // each .so independently, so every library must also find its own siblings.
  // Modify only the isolated release copies, never the development SDK.
  for(const name of names) await run(patchelf, ['--set-rpath', '$ORIGIN', path.join(directory, name)], {env, capture: true, log});
  const clean = {...env}; delete clean.LD_LIBRARY_PATH; delete clean.LD_PRELOAD;
  for(const name of names) {
    const file = path.join(directory, name);
    const dependencies = await run('ldd', [file], {env: clean, capture: true, log});
    if(/=>\s*not found/.test(dependencies)) throw new Error(`Unresolved packaged dependencies for ${name}:\n${dependencies}`);
    for(const match of dependencies.matchAll(/^\s*(lib(?:avcodec|avdevice|avfilter|avformat|avutil|swscale|swresample)\.so\.[\d.]+)\s+=>\s+(.+?)\s+\(/gm)) {
      if(path.dirname(path.resolve(match[2])) !== path.resolve(directory)) throw new Error(`${name} resolved ${match[1]} outside the packaged media SDK: ${match[2]}`);
    }
  }
  console.log(`All ${names.length} native media libraries resolve independently from their packaged directory.`);
}
