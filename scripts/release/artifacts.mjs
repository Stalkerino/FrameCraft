import {copyFile, mkdir, readdir, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';

// Preserve the finished installer before deleting its generated unpacked tree.
// Moving avoids another full installer copy on space-limited CI runners.
export async function collectInstaller(bundleRoot, output, format) {
  const suffix = {deb: '.deb', appimage: '.AppImage', nsis: '-setup.exe'}[format];
  if(!suffix) throw new Error(`Unsupported bundle format: ${format}`);
  const directory = path.join(bundleRoot, format);
  const candidates = (await readdir(directory, {withFileTypes: true})).filter(entry => entry.isFile() && entry.name.endsWith(suffix));
  if(candidates.length !== 1) throw new Error(`Expected one ${format} installer, found ${candidates.length}.`);
  const source = path.join(directory, candidates[0].name);
  if((await stat(source)).size === 0) throw new Error(`Empty ${format} installer.`);
  await mkdir(output, {recursive: true});
  const destination = path.join(output, candidates[0].name);
  await rename(source, destination).catch(async error => {
    if(error.code !== 'EXDEV') throw error;
    // Custom Cargo targets may live on a different filesystem.
    await copyFile(source, destination);
    await rm(source);
  });
  await rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 500});
  return destination;
}
