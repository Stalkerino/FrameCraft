import path from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {clipSchema, type Project} from '../shared/project';
import {defaultTracks} from '../shared/tracks';
import {ffmpegPath, runProcess} from '../server/services/process-service';
import {applyColorGradeStages, colorGradeStages, colorGradeSchema} from '../shared/color-grading';

export function compositionSmokeProject(project: Project): Project {
  return {...project, backgroundColor: '#18212a', tracks: [{id: 'detail', name: 'Video 2', type: 'visual', muted: false, hidden: false}, ...defaultTracks], clips: [
    clipSchema.parse({id: 'left', name: 'Left video', kind: 'video', track: 'visual', assetId: 'source', start: 0, duration: 20, sourceStart: 0, x: 25, scale: .5, volume: .3}),
    clipSchema.parse({id: 'right', name: 'Right cropped video', kind: 'video', track: 'visual', trackId: 'detail', assetId: 'source', start: 0, duration: 10, sourceStart: 10, x: 75, scale: .5, volume: .3,
      crop: {left: 25, right: 0, top: 0, bottom: 0}, audioEnvelope: {duration: 10, fadeOut: 5}}),
  ]};
}

export const effectsImage = {width: 640, height: 360, channels: 4 as const};
export function effectsImagePixels() {
  const pixels = Buffer.alloc(640 * 360 * 4);
  for(let y = 0; y < 360; y++) for(let x = 0; x < 640; x++) {
    const rgba = x < 320 ? [180, 70, 30, 128] : x < 480 ? [20, 130, 210, 255] : [80, 180, 60, 0];
    pixels.set(rgba, (y * 640 + x) * 4);
  }
  return pixels;
}
export function effectsSmokeProject(original: Project): Project {
  const project = compositionSmokeProject(original);
  const grade = colorGradeSchema.parse({exposure: -.3, contrast: 1.15, saturation: .6, temperature: .2, tint: -.1, hue: 10, gamma: 1.2});
  return {...project, colorGrade: colorGradeSchema.parse({gamma: .9}),
    tracks: [{id: 'image-top', name: 'Image', type: 'visual', muted: false, hidden: false}, ...project.tracks!],
    assets: [...project.assets, {id: 'image', name: 'RGBA test', kind: 'image', src: '/media/image.png', width: 640, height: 360, duration: 1 / 30}],
    clips: [...project.clips.map((clip, index) => ({...clip, opacity: index ? .7 : .5, colorGrade: index ? null : grade})),
      clipSchema.parse({id: 'image', name: 'RGBA overlay', kind: 'image', track: 'visual', trackId: 'image-top', assetId: 'image', start: 0, duration: 30,
        x: 75, scale: .5, opacity: .6, colorGrade: grade, crop: {left: 25, right: 0, top: 0, bottom: 0}})]};
}

/** Explicit hardware harness only. CPU pixel readback and independent, fixed
 * reference rectangles validate both layers, their removal, crop and empty
 * canvas. Never called by production exports or routine tests.
 */
export async function compareCompositionSmoke(output: string, source: string, directory: string, effectsProject?: Project) {
  const differences: number[] = [];
  for(const frame of [3, 14, 24]) {
    const gradeImage = async (input: Buffer, clipId: string) => {
      if(!effectsProject) return input;
      const clip = effectsProject.clips.find(clip => clip.id === clipId)!;
      const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      const stages = colorGradeStages(clip.colorGrade, effectsProject.colorGrade);
      for(let i = 0; i < data.length; i += 4) {
        const rgb = applyColorGradeStages([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255], stages);
        rgb.forEach((value, channel) => {data[i + channel] = Math.round(value * 255);});
        data[i + 3] = Math.round(data[i + 3] * clip.opacity);
      }
      return sharp(data, {raw: {width: info.width, height: info.height, channels: 4}}).png().toBuffer();
    };
    const image = async (file: string, index: number, selected: number, geometry = '', clipId?: string) => {
      const png = path.join(directory, `scene-${frame}-${index}.png`);
      // Match the SDR preview/reference: decode the tagged YUV matrix to RGB.
      // An extra transfer conversion would also change the encoded CSS canvas
      // color while the independently created reference keeps its RGB values.
      await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-i', file, '-an',
        '-vf', `select=eq(n\\,${selected}),format=rgb24${geometry}`, '-frames:v', '1', '-y', png], 10000);
      const bytes = await readFile(png); return clipId ? gradeImage(bytes, clipId) : bytes;
    };
    const actual = await image(output, 0, frame);
    const layers: sharp.OverlayOptions[] = [];
    if(frame < 20) layers.push({input: await image(source, 1, frame, ',scale=160:90:flags=lanczos', 'left'), left: 0, top: 45});
    if(frame < 10) layers.push({input: await image(source, 2, frame + 10, ',crop=480:360:160:0,scale=120:90:flags=lanczos', 'right'), left: 200, top: 45});
    if(effectsProject) {
      const asset = await sharp(effectsImagePixels(), {raw: effectsImage}).extract({left: 160, top: 0, width: 480, height: 360}).resize(120, 90).png().toBuffer();
      layers.push({input: await gradeImage(asset, 'image'), left: 200, top: 45});
    }
    const reference = await sharp({create: {width: 320, height: 180, channels: 3, background: '#18212a'}}).composite(layers).png().toBuffer();
    await writeFile(path.join(directory, `scene-${frame}-reference.png`), reference);
    // Test each region separately so a missing small layer cannot pass by
    // averaging its error over the much larger, correct background region.
    for(const region of [{left: 8, top: 50, width: 140, height: 80}, {left: 208, top: 50, width: 104, height: 80}, {left: 8, top: 8, width: 300, height: 24}]) {
      const a = await sharp(actual).extract(region).removeAlpha().raw().toBuffer();
      const b = await sharp(reference).extract(region).removeAlpha().raw().toBuffer();
      const error = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
      differences.push(error);
      if(error > 14) throw new Error(`Composition frame ${frame}, region x=${region.left}, differs from reference: ${error.toFixed(2)} mean pixel error.`);
    }
  }
  return differences;
}
