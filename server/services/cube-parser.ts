import {createHash} from 'node:crypto';
import {colorLutSchema, type ColorLut} from '../../shared/color-lut';

/** Strict .cube 3D reader. Reject unsupported shapers rather than silently discarding them. */
export function parseColorCube(text: string, filename: string): ColorLut {
  if(Buffer.byteLength(text) > 20_000_000) throw new Error('Cube file exceeds 20 MB.');
  let size = 0; let name = filename.replace(/\.cube$/i, ''); let min: [number, number, number] = [0, 0, 0]; let max: typeof min = [1, 1, 1];
  const values: number[] = []; const seen = new Set<string>();
  for(const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, '').trim(); if(!line) continue;
    const parts = line.split(/\s+/); const directive = parts[0];
    if(/^[A-Z][A-Z0-9_]*$/.test(directive)) {
      if(seen.has(directive)) throw new Error(`Duplicate ${directive} on line ${index + 1}.`); seen.add(directive);
      if(directive === 'TITLE') {name = line.slice(5).trim().replace(/^"|"$/g, ''); continue;}
      if(directive === 'LUT_3D_SIZE') {size = Number(parts[1]); if(parts.length !== 2 || !Number.isInteger(size) || size < 2 || size > 65) throw new Error('Use a 3D LUT grid from 2 to 65.'); continue;}
      if(directive === 'DOMAIN_MIN' || directive === 'DOMAIN_MAX') {
        const triple = parts.slice(1).map(Number); if(triple.length !== 3 || triple.some(v => !Number.isFinite(v))) throw new Error(`Invalid domain on line ${index + 1}.`);
        if(directive === 'DOMAIN_MIN') min = triple as typeof min; else max = triple as typeof max; continue;
      }
      throw new Error(`Unsupported cube directive ${directive}. Export a standalone 3D .cube LUT (no 1D shaper).`);
    }
    const row = parts.map(Number); if(row.length !== 3 || row.some(v => !Number.isFinite(v) || Math.abs(v) > 65504)) throw new Error(`Invalid LUT sample on line ${index + 1}.`);
    if(!size || values.length >= size ** 3 * 3) throw new Error('Declare LUT_3D_SIZE before samples and include exactly that grid.');
    values.push(...row);
  }
  if(values.length !== size ** 3 * 3 || !size) throw new Error('Incomplete cube grid.');
  const bytes = Buffer.alloc(values.length * 4); values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  const id = createHash('sha256').update(JSON.stringify([size, min, max])).update(bytes).digest('hex');
  return colorLutSchema.parse({id, name: (name.trim() || 'Imported LUT').slice(0, 160), size, domainMin: min, domainMax: max, data: bytes.toString('base64')});
}
