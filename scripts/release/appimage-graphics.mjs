import {chmod, mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

// Mesa is supplied by the host. Its Wayland dependencies must come from the
// same host, not Ubuntu's older ABI bundled by linuxdeploy's GTK/GStreamer pass.
export async function useHostGraphicsLibraries(appdir) {
  if(!appdir || !path.basename(appdir).endsWith('.AppDir')) throw new Error('Expected a generated .AppDir');
  const removed = [];
  async function visit(directory) {
    for(const entry of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if(entry.isDirectory()) await visit(file);
      else if(/^libwayland-(client|server|cursor|egl)\.so(?:\.\d+)*$/.test(entry.name)) {
        await rm(file); removed.push(file);
      }
    }
  }
  await visit(path.join(appdir, 'usr/lib'));
  console.log(`AppImage: using host Wayland libraries (${removed.length} bundled copies removed).`);
  return removed;
}

export async function prepareAppImageOutput(toolsDirectory) {
  await mkdir(toolsDirectory, {recursive: true});
  const plugin = path.join(toolsDirectory, 'linuxdeploy-plugin-appimage.AppImage');
  const vendor = path.join(toolsDirectory, 'framecraft-tools'); await mkdir(vendor, {recursive: true});
  const upstream = path.join(vendor, 'appimage-output.AppImage');
  const existing = await readFile(plugin).catch(error => {if(error.code !== 'ENOENT') throw error;});
  if(existing?.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) await rename(plugin, upstream);
  else if(existing && !existing.toString().includes('# Framecraft AppImage output adapter')) throw new Error('Unrecognized AppImage output plugin; refusing to replace it.');
  try {await readFile(upstream);}
  catch(error) {
    if(error.code !== 'ENOENT') throw error;
    const response = await fetch('https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage', {signal: AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`AppImage output plugin download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if(!bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Invalid AppImage output plugin download.');
    await writeFile(upstream, bytes);
  }
  await chmod(upstream, 0o755);
  // linuxdeploy's output plugin runs after all dependency deployment, before
  // compression. No second extraction/compression or Rust compilation needed.
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(plugin, `#!/bin/sh\n# Framecraft AppImage output adapter\nexec ${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} ${quote(upstream)} "$@"\n`);
  await chmod(plugin, 0o755);
}

if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [upstream, ...args] = process.argv.slice(2);
  const index = args.indexOf('--appdir');
  const appdir = index >= 0 ? args[index + 1] : args.find(arg => arg.startsWith('--appdir='))?.slice(9);
  if(appdir) await useHostGraphicsLibraries(path.resolve(appdir));
  else if(!args.includes('--plugin-api-version') && !args.includes('--plugin-type')) throw new Error('AppImage output plugin did not receive --appdir.');
  const child = spawn(upstream, args, {stdio: 'inherit', env: {...process.env, APPIMAGE_EXTRACT_AND_RUN: '1'}});
  child.once('error', error => {console.error(error); process.exitCode = 1;});
  child.once('close', code => {process.exitCode = code ?? 1;});
}
