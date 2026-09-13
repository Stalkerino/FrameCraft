import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {expect, it} from 'vitest';
import {prepareNativeImage} from '../server/services/rendering/native-image-service';

it('prepares one straight-alpha RGBA texture and rejects stale dimensions before GPU use', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fc-image-unit-'));
  try {
    const pixels = Buffer.from([64, 96, 128, 128, 200, 100, 20, 255]);
    const source = path.join(directory, 'source.png');
    await sharp(pixels, {raw: {width: 2, height: 1, channels: 4}}).png().toFile(source);
    const asset = {id: 'image', name: 'Image', kind: 'image' as const, src: '/media/source.png', width: 2, height: 1, duration: 1};
    const file = await prepareNativeImage(source, asset, directory, 0);
    expect(await readFile(file)).toEqual(pixels);
    await expect(prepareNativeImage(source, {...asset, width: 20}, directory, 1)).rejects.toThrow('dimensions changed');
  } finally {await rm(directory, {recursive: true, force: true});}
});
