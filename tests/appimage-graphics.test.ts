import {expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {useHostGraphicsLibraries, prepareAppImageOutput} = await import(new URL('../scripts/release/appimage-graphics.mjs', import.meta.url).href);

it('excludes bundled Wayland without removing private media or unrelated libraries', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fc-appimage-'));
  try {
    const appdir = path.join(directory, 'Framecraft.AppDir');
    for(const lib of ['usr/lib/libwayland-client.so.0', 'usr/lib/x86_64-linux-gnu/libwayland-server.so.0.1.0', 'usr/lib/libwebkit2gtk-4.1.so.0', 'usr/lib/framecraft/libavcodec.so.62', 'usr/share/framecraft/app/private.so']) {
      await mkdir(path.dirname(path.join(appdir, lib)), {recursive: true});
      await writeFile(path.join(appdir, lib), 'retained');
    }
    // Linux packaging includes both versioned files and symlink aliases.
    if(process.platform !== 'win32') await symlink('libwayland-client.so.0', path.join(appdir, 'usr/lib/libwayland-client.so'));
    expect((await useHostGraphicsLibraries(appdir)).length).toBe(process.platform === 'win32' ? 2 : 3);
    expect(await readFile(path.join(appdir, 'usr/lib/libwebkit2gtk-4.1.so.0'), 'utf8')).toBe('retained');
    expect(await readFile(path.join(appdir, 'usr/lib/framecraft/libavcodec.so.62'), 'utf8')).toBe('retained');
    expect(await readFile(path.join(appdir, 'usr/share/framecraft/app/private.so'), 'utf8')).toBe('retained');
    expect(await readdir(path.join(appdir, 'usr/lib/x86_64-linux-gnu'))).toEqual([]);
    await expect(useHostGraphicsLibraries(directory)).rejects.toThrow('generated .AppDir');
  } finally {await rm(directory, {recursive: true, force: true});}
});

it('preserves the cached upstream plugin across repeated builds without downloading it again', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fc-plugin-'));
  try {
    const plugin = path.join(directory, 'linuxdeploy-plugin-appimage.AppImage');
    const upstreamBytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);
    await writeFile(plugin, upstreamBytes);
    await prepareAppImageOutput(directory);
    await prepareAppImageOutput(directory);
    expect(await readFile(path.join(directory, 'framecraft-tools/appimage-output.AppImage'))).toEqual(upstreamBytes);
    expect(await readFile(plugin, 'utf8')).toContain('# Framecraft AppImage output adapter');
  } finally {await rm(directory, {recursive: true, force: true});}
});
