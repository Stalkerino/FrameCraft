import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {expect, it} from 'vitest';
import {normalizeArtworkFrames} from '../server/services/artwork-image-service';

it('makes opaque artwork RGBA without changing pixels and leaves existing RGBA bytes intact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-artwork-'));
  try {
    const rgb = path.join(directory, 'frame-0000.png');
    const rgba = path.join(directory, 'frame-0001.png');
    await sharp(Buffer.from([12, 34, 56, 78, 90, 123]), {raw: {width: 2, height: 1, channels: 3}}).png().toFile(rgb);
    await sharp(Buffer.from([12, 34, 56, 127, 78, 90, 123, 255]), {raw: {width: 2, height: 1, channels: 4}}).png().toFile(rgba);
    const originalRgba = await readFile(rgba);
    expect((await readFile(rgb))[25]).toBe(2);
    const progress: number[] = [];
    await normalizeArtworkFrames(path.join(directory, 'frame-%04d.png'), [0, 1], value => progress.push(value));
    expect((await readFile(rgb))[25]).toBe(6);
    expect((await sharp(rgb).metadata()).channels).toBe(4);
    expect(await sharp(rgb).raw().toBuffer()).toEqual(Buffer.from([12, 34, 56, 255, 78, 90, 123, 255]));
    expect(await readFile(rgba)).toEqual(originalRgba);
    expect(progress).toEqual([1, 2]);
    await writeFile(path.join(directory, 'frame-0002.png'), 'not a PNG');
    await expect(normalizeArtworkFrames(path.join(directory, 'frame-%04d.png'), [2])).rejects.toThrow('Unsupported artwork PNG');
  } finally {await rm(directory, {recursive: true, force: true});}
});
