import {open, rename, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function artworkColorType(file: string): Promise<number> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(33);
    const {bytesRead} = await handle.read(header, 0, header.length, 0);
    if(bytesRead !== header.length || !header.subarray(0, 8).equals(pngSignature) || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR'
      || header[24] !== 8 || ![0, 2, 3, 4, 6].includes(header[25])) {
      throw new Error(`Unsupported artwork PNG: ${path.basename(file)}. Expected an 8-bit PNG frame.`);
    }
    return header[25];
  } finally {await handle.close();}
}

/** Normalize only Remotion-generated scratch frames, never imported user images. */
export async function normalizeArtworkFrames(pattern: string, frameNumbers: readonly number[], onProgress?: (completed: number, total: number) => void): Promise<void> {
  const placeholder = /%(?:0(\d+))?d/;
  if(!placeholder.test(pattern)) throw new Error('Artwork image sequence is missing its frame-number placeholder.');
  // Called in the render worker. Keep libvips from retaining decoded frames or
  // spreading simultaneous image work across all available CPU cores.
  sharp.cache({memory: 8, files: 0, items: 8});
  sharp.concurrency(1);
  for(const [index, frame] of frameNumbers.entries()) {
    if(!Number.isInteger(frame) || frame < 0) throw new Error(`Invalid artwork frame number: ${frame}`);
    const file = pattern.replace(placeholder, (_match, digits: string | undefined) => String(frame).padStart(Number(digits ?? 0), '0'));
    if(await artworkColorType(file) !== 6) {
      const temporary = `${file}.${randomUUID()}.rgba.png`;
      try {
        await sharp(file).toColourspace('srgb').ensureAlpha().png({compressionLevel: 1, palette: false}).toFile(temporary);
        if(await artworkColorType(temporary) !== 6) throw new Error(`Could not normalize artwork to RGBA: ${path.basename(file)}`);
        await rename(temporary, file);
      } catch(error) {
        throw new Error(`Could not prepare artwork frame ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
      } finally {await rm(temporary, {force: true});}
    }
    onProgress?.(index + 1, frameNumbers.length);
  }
}
