import {expect, it} from 'vitest';
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyColorGradeStages, colorGradeSchema, colorGradeStages, isNeutralColorGrade, neutralColorGrade, type Rgb} from '../shared/color-grading';
import {ColorGradeLutService} from '../server/services/color-grade-lut-service';
import {ffmpegPath, runProcess} from '../server/services/process-service';

it('bypasses neutral grades and preserves gray through hue and saturation changes', () => {
  expect(isNeutralColorGrade(null)).toBe(true);
  expect(isNeutralColorGrade(neutralColorGrade)).toBe(true);
  expect(colorGradeStages(null, {})).toEqual([]);
  const gray = applyColorGradeStages([.4, .4, .4], colorGradeStages({hue: 123, saturation: 2}, null));
  for(const channel of gray) expect(channel).toBeCloseTo(.4, 10);
  const monochrome = applyColorGradeStages([.2, .5, .8], colorGradeStages({saturation: 0}, null));
  for(const channel of monochrome) expect(channel).toBeCloseTo(.2 * .213 + .5 * .715 + .8 * .072, 10);
});

it('applies the clip correction before the project grade and validates control ranges', () => {
  const forward = applyColorGradeStages([.2, .2, .2], colorGradeStages({exposure: 1}, {contrast: .5}));
  const reverse = applyColorGradeStages([.2, .2, .2], colorGradeStages({contrast: .5}, {exposure: 1}));
  expect(forward[0]).toBeCloseTo(.45, 10);
  expect(reverse[0]).toBeCloseTo(.7, 10);
  expect(() => colorGradeSchema.parse({exposure: 5})).toThrow();
  expect(() => colorGradeSchema.parse({gamma: 0})).toThrow();
  const bounded = applyColorGradeStages([.99, .01, .5], colorGradeStages({exposure: 4, contrast: 3, saturation: 3, hue: -180}, {gamma: .25}));
  expect(bounded.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
});

it('matches native RGB samples to shared grading, preserves dark gamma detail, and blends opacity last', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-color-test-'));
  try {
    // Spaces, quotes and filtergraph separators are legal in user workspace paths.
    const cache = path.join(directory, "grading's [files], set"); await mkdir(cache);
    const service = new ColorGradeLutService(cache);
    expect(await service.ensure(null, null)).toBeUndefined();
    expect(await readdir(cache)).toEqual([]);
    const pixels: Rgb[] = [[1, 1, 1], [8, 4, 12], [32, 48, 64], [72, 96, 120], [128, 160, 192], [220, 200, 160], [80, 140, 200], [190, 110, 65]];
    const source = path.join(directory, 'samples.ppm');
    await writeFile(source, Buffer.concat([Buffer.from(`P6\n${pixels.length} 2\n255\n`), Buffer.from([...pixels, ...pixels].flat())]));
    const clip = colorGradeSchema.parse({exposure: .2, contrast: .9, saturation: .8, temperature: .2, tint: -.1, hue: 12, gamma: 1.1});
    const project = colorGradeSchema.parse({contrast: .9, gamma: 1.05});
    for(const variant of [{clip, project, opacity: .6, background: '#304050'}, {clip: colorGradeSchema.parse({gamma: 4}), project: null, opacity: 1, background: '#000000'}]) {
      const filter = await service.ensure(variant.clip, variant.project, variant.opacity, variant.background);
      expect(await service.ensure(variant.clip, variant.project, variant.opacity, variant.background)).toBe(filter);
      const chunks: Buffer[] = [];
      await runProcess(ffmpegPath(), ['-v', 'error', '-i', source, '-vf', `${filter},scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24`, '-filter_threads', '1', '-threads', '1', '-frames:v', '1', '-f', 'rawvideo', '-'], 15000, {onOutput: chunk => chunks.push(chunk)});
      const output = Buffer.concat(chunks); expect(output.length).toBe(pixels.length * 2 * 3);
      const stages = colorGradeStages(variant.clip, variant.project);
      for(const [index, pixel] of pixels.entries()) {
        const graded = applyColorGradeStages(pixel.map(value => value / 255) as Rgb, stages);
        for(let channel = 0; channel < 3; channel++) {
          const background = parseInt(variant.background.slice(1 + channel * 2, 3 + channel * 2), 16);
          const expected = graded[channel] * 255 * variant.opacity + background * (1 - variant.opacity);
          // Matrix-grid interpolation and 8-bit RGB/YUV conversion may differ by a few code values.
          expect(Math.abs(output[index * 3 + channel] - expected), `sample ${index}, channel ${channel}`).toBeLessThanOrEqual(4);
        }
      }
    }
    // Two correction matrices are reused; gamma-only needs no 3D LUT file.
    expect((await readdir(cache)).filter(file => file.endsWith('.cube'))).toHaveLength(2);
  } finally {await rm(directory, {recursive: true, force: true});}
}, 20000);
