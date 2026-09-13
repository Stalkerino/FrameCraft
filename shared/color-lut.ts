import {z} from 'zod';
const triple = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const colorLutSchema = z.object({id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(160), size: z.number().int().min(2).max(65),
  domainMin: triple, domainMax: triple, data: z.string().max(4_500_000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict().superRefine((lut, context) => {
  if(lut.domainMin.some((v, i) => v >= lut.domainMax[i])) context.addIssue({code: 'custom', message: 'LUT domain must increase on every channel.'});
  const bytes = lut.data.length * 3 / 4 - (lut.data.endsWith('==') ? 2 : lut.data.endsWith('=') ? 1 : 0);
  if(bytes !== lut.size ** 3 * 3 * 4) context.addIssue({code: 'custom', message: 'LUT data size does not match its grid.'});
});
export type ColorLut = z.infer<typeof colorLutSchema>;
const cache = new WeakMap<ColorLut, Float32Array>();
export function lutValues(lut: ColorLut): Float32Array {
  const existing = cache.get(lut); if(existing) return existing;
  const bytes = Uint8Array.from(atob(lut.data), c => c.charCodeAt(0)); const view = new DataView(bytes.buffer);
  const values = Float32Array.from({length: bytes.length / 4}, (_, i) => view.getFloat32(i * 4, true));
  if(values.some(value => !Number.isFinite(value))) throw new Error('LUT contains non-finite values.');
  cache.set(lut, values); return values;
}
export function sampleColorLut(lut: ColorLut, rgb: number[]): [number, number, number] {
  const table = lutValues(lut); const n = lut.size;
  const p = rgb.map((value, i) => Math.max(0, Math.min(1, (value - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i]))) * (n - 1));
  const lo = p.map(Math.floor); const hi = lo.map(value => Math.min(n - 1, value + 1)); const f = p.map((v, i) => v - lo[i]);
  const output = [0, 0, 0];
  for(let b = 0; b < 2; b++) for(let g = 0; g < 2; g++) for(let r = 0; r < 2; r++) {
    const index = ((b ? hi[2] : lo[2]) * n * n + (g ? hi[1] : lo[1]) * n + (r ? hi[0] : lo[0])) * 3;
    const weight = (r ? f[0] : 1 - f[0]) * (g ? f[1] : 1 - f[1]) * (b ? f[2] : 1 - f[2]);
    for(let channel = 0; channel < 3; channel++) output[channel] += table[index + channel] * weight;
  }
  return output as [number, number, number];
}
