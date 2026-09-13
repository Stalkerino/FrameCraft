import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import sharp from 'sharp';
import type {Asset} from '../../../shared/project';

/** Decode each static asset once per job, before GPU rendering. Raw RGBA is
 * uploaded once per scene span and looped as a GPU frame, not re-decoded per frame.
 */
export async function prepareNativeImage(file: string, asset: Asset, workspace: string, index: number) {
  const image = sharp(file, {limitInputPixels: 64 * 1024 * 1024});
  const metadata = await image.metadata();
  if(!['png', 'jpeg', 'webp', 'avif'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error(`${asset.name}: native images currently require a static PNG, JPEG, WebP or AVIF.`);
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  if((rotated ? metadata.height : metadata.width) !== asset.width || (rotated ? metadata.width : metadata.height) !== asset.height) throw new Error(`${asset.name}: image dimensions changed; reimport it before rendering.`);
  const directory = path.join(workspace, 'native-images'); await mkdir(directory, {recursive: true});
  const destination = path.join(directory, `${index}.rgba`);
  await pipeline(image.rotate().toColourspace('srgb').ensureAlpha().raw(), createWriteStream(destination, {flags: 'wx'}));
  return destination;
}
