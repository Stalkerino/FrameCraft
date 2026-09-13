import {expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {collectInstaller} = await import(new URL('../scripts/release/artifacts.mjs', import.meta.url).href);

it('retains each installer while reclaiming only its unpacked bundle between formats', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fc-release-storage-'));
  try {
    const bundles = path.join(root, 'target/release/bundle');
    const output = path.join(root, 'artifacts');
    await mkdir(path.join(root, 'target/release/deps'), {recursive: true});
    await writeFile(path.join(root, 'target/release/deps/cached'), 'Rust cache');
    for(const [format, filename] of [['deb', 'Framecraft.deb'], ['appimage', 'Framecraft.AppImage'], ['nsis', 'Framecraft-setup.exe']]) {
      await mkdir(path.join(bundles, format, 'unpacked'), {recursive: true});
      await writeFile(path.join(bundles, format, 'unpacked/payload'), 'temporary runtime');
      await writeFile(path.join(bundles, format, filename), format);
      const artifact = await collectInstaller(bundles, output, format);
      expect(await readFile(artifact, 'utf8')).toBe(format);
      expect(await readdir(bundles)).toEqual([]);
    }
    expect((await readdir(output)).length).toBe(3);
    expect(await readFile(path.join(root, 'target/release/deps/cached'), 'utf8')).toBe('Rust cache');
  } finally {await rm(root, {recursive: true, force: true});}
});

it('preserves staging when an installer is missing or empty', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fc-release-incomplete-'));
  try {
    await mkdir(path.join(root, 'bundle/deb'), {recursive: true});
    await writeFile(path.join(root, 'bundle/deb/diagnostic.txt'), 'keep');
    await expect(collectInstaller(path.join(root, 'bundle'), path.join(root, 'output'), 'deb')).rejects.toThrow('Expected one');
    await writeFile(path.join(root, 'bundle/deb/Framecraft.deb'), '');
    await expect(collectInstaller(path.join(root, 'bundle'), path.join(root, 'output'), 'deb')).rejects.toThrow('Empty');
    expect(await readFile(path.join(root, 'bundle/deb/diagnostic.txt'), 'utf8')).toBe('keep');
  } finally {await rm(root, {recursive: true, force: true});}
});
