import {z} from 'zod';
import {sampleColorLut, type ColorLut} from './color-lut';

export const colorGradeSchema = z.object({
  space: z.enum(['srgb', 'linear-srgb']).optional(),
  lut: z.object({id: z.string().regex(/^[a-f0-9]{64}$/), strength: z.number().min(0).max(1).default(1)}).nullable().optional(),
  exposure: z.number().min(-4).max(4).default(0),
  contrast: z.number().min(0).max(3).default(1),
  saturation: z.number().min(0).max(3).default(1),
  temperature: z.number().min(-1).max(1).default(0),
  tint: z.number().min(-1).max(1).default(0),
  gamma: z.number().min(.25).max(4).default(1),
  hue: z.number().min(-180).max(180).default(0),
});
export type ColorGrade = z.infer<typeof colorGradeSchema>;
export const neutralColorGrade: ColorGrade = {exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, gamma: 1, hue: 0};
type Grade = Partial<ColorGrade> | null | undefined;
export interface ColorGradeStage {matrix: number[]; exponent: number; space?: 'linear-srgb'; lut?: ColorLut; strength?: number}
export type Rgb = [number, number, number];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function isNeutralColorGrade(grade: Grade): boolean {
  return !grade || (!grade.lut?.strength && (Object.keys(neutralColorGrade) as (keyof ColorGrade)[]).every(key => (grade[key] ?? neutralColorGrade[key]) === neutralColorGrade[key]));
}

function multiply(a: number[], b: number[]): number[] {
  return Array.from({length: 9}, (_, index) => {
    const row = Math.floor(index / 3); const column = index % 3;
    return a[row * 3] * b[column] + a[row * 3 + 1] * b[column + 3] + a[row * 3 + 2] * b[column + 6];
  });
}

/** One sRGB matrix, clamped before gamma, shared by browser filters and native LUTs. */
export function colorGradeStage(value: Grade, luts: ColorLut[] = []): ColorGradeStage {
  const grade = colorGradeSchema.parse(value ?? {});
  const angle = grade.hue * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
  // SVG's hue-rotation coefficients preserve neutral grays.
  const hue = [.213 + .787 * c - .213 * s, .715 - .715 * c - .715 * s, .072 - .072 * c + .928 * s,
    .213 - .213 * c + .143 * s, .715 + .285 * c + .140 * s, .072 - .072 * c - .283 * s,
    .213 - .213 * c - .787 * s, .715 - .715 * c + .715 * s, .072 + .928 * c + .072 * s];
  const saturation = [.213, .715, .072].flatMap((_, row) => [.213, .715, .072].map((weight, column) => weight * (1 - grade.saturation) + (row === column ? grade.saturation : 0)));
  const exposure = 2 ** grade.exposure;
  const balance = [exposure * 2 ** (.35 * grade.temperature + .175 * grade.tint), 0, 0,
    0, exposure * 2 ** (-.35 * grade.tint), 0,
    0, 0, exposure * 2 ** (-.35 * grade.temperature + .175 * grade.tint)];
  const rgb = multiply(saturation, multiply(hue, balance)).map(value => value * grade.contrast);
  const bias = .5 * (1 - grade.contrast);
  const lut = grade.lut?.strength ? luts.find(lut => lut.id === grade.lut!.id) : undefined;
  if(grade.lut?.strength && !lut) throw new Error('A referenced LUT is missing from this project.');
  return {...(grade.space === 'linear-srgb' ? {space: grade.space} : {}), ...(lut ? {lut, strength: grade.lut!.strength} : {}), matrix: [rgb[0], rgb[1], rgb[2], 0, bias, rgb[3], rgb[4], rgb[5], 0, bias, rgb[6], rgb[7], rgb[8], 0, bias, 0, 0, 0, 1, 0], exponent: 1 / grade.gamma};
}

/** A clip correction is followed by the project's finishing grade. */
export function colorGradeStages(clip: Grade, project: Grade, luts: ColorLut[] = []): ColorGradeStage[] {
  return [clip, project].filter(grade => !isNeutralColorGrade(grade)).map(grade => colorGradeStage(grade, luts));
}

export function applyColorGradeStages(input: Rgb, stages: ColorGradeStage[]): Rgb {
  let rgb = input;
  for(const {matrix: m, exponent, space, lut, strength = 1} of stages) {
    if(space === 'linear-srgb') rgb = rgb.map(srgbToLinear) as Rgb;
    rgb = [0, 1, 2].map(row => {
      const offset = row * 5;
      return clamp(m[offset] * rgb[0] + m[offset + 1] * rgb[1] + m[offset + 2] * rgb[2] + m[offset + 4]) ** exponent;
    }) as Rgb;
    if(space === 'linear-srgb') rgb = rgb.map(linearToSrgb) as Rgb;
    if(lut) {const looked = sampleColorLut(lut, rgb); rgb = rgb.map((v, i) => clamp(v + (looked[i] - v) * strength)) as Rgb;}
  }
  return rgb;
}

export function colorGradeKey(clip: Grade, project: Grade): string {
  return JSON.stringify(colorGradeStages(clip, project));
}

/** Standard .cube ordering: red varies fastest, then green, then blue. */
export function colorGradeCube(clip: Grade, project: Grade, size = 33): string {
  return stageCube(colorGradeStages(clip, project), size);
}

/** Keep gamma outside the 3D grid so very dark samples retain their precision. */
export function colorGradeMatrixCube(matrix: number[], size = 33): string {
  return stageCube([{matrix, exponent: 1}], size);
}

function stageCube(stages: ColorGradeStage[], size: number): string {
  if(!Number.isInteger(size) || size < 2 || size > 65) throw new Error('Choose a color LUT grid between 2 and 65 points per channel.');
  const lines = ['TITLE "Framecraft sRGB grading"', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for(let blue = 0; blue < size; blue++) for(let green = 0; green < size; green++) for(let red = 0; red < size; red++) {
    lines.push(applyColorGradeStages([red / (size - 1), green / (size - 1), blue / (size - 1)], stages).map(value => value.toFixed(8)).join(' '));
  }
  return lines.join('\n') + '\n';
}

export const srgbToLinear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const linearToSrgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
