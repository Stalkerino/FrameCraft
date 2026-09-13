import path from 'node:path';
import sharp from 'sharp';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {browserExecutable} from '../server/services/browser-service';
import {runProcess, ffmpegPath} from '../server/services/process-service';
import {clipSchema, type Project} from '../shared/project';
import {presetDefinitionSchema, type PresetInstance} from '../shared/asset-presets';

export function artworkSmokeProject(original: Project): Project {
  const recipe = (name: string, value: unknown): PresetInstance => ({presetId: name, version: 1, definition: presetDefinitionSchema.parse(value), values: {}, duration: 1});
  const background = (name: string, fill: string) => recipe(name, {schemaVersion: 1, name, category: 'background', layers: [
    {id: 'base', type: 'rect', width: 100, height: 100, fill},
    {id: 'ellipse', type: 'ellipse', x: 80, y: 70, width: 25, height: 34, fill: '#bc8cff', stroke: '#ffffff', strokeWidth: .5, rotation: {keyframes: [{at: 0, value: -20}, {at: 1, value: 20}]}},
    {id: 'box', type: 'rect', x: 18, y: 74, width: 22, height: 24, radius: 3, stroke: '#77ccff', strokeWidth: 1, fill: '#18212a', opacity: .8},
  ]});
  const transition = recipe('iris', {schemaVersion: 1, name: 'Iris', category: 'transition', reveal: {type: 'iris'}, layers: [{id: 'bar', type: 'rect', y: 92, width: {keyframes: [{at: 0, value: 0}, {at: 1, value: 100}]}, height: 2, fill: '#77ccff'}]});
  const title = recipe('title', {schemaVersion: 1, name: 'Vector title', category: 'title', layers: [
    {id: 'text', type: 'text', text: 'GPU\nDEVLOG', fontSize: {keyframes: [{at: 0, value: 12}, {at: 1, value: 15}], easing: 'linear'}, y: 35, fill: '#ffffff', stroke: '#77ccff', strokeWidth: .2, rotation: {keyframes: [{at: 0, value: -5}, {at: 1, value: 5}], easing: 'linear'}},
    {id: 'caption', type: 'text', text: 'Saved assets · MCP', fontSize: 5, y: 70, weight: '400', fill: '#ffffff'},
  ]});
  return {...original, assets: [], clips: [
    clipSchema.parse({id: 'first', name: 'Outgoing recipe', kind: 'graphic', track: 'visual', start: 0, duration: 10, graphic: background('first', '#18212a')}),
    clipSchema.parse({id: 'second', name: 'Incoming recipe', kind: 'graphic', track: 'visual', start: 10, duration: 20, graphic: background('second', '#4f234b'), presetTransition: transition, transitionFrames: 10}),
    clipSchema.parse({id: 'title', name: 'GPU text', kind: 'graphic', track: 'text', start: 0, duration: 30, graphic: title}),
    clipSchema.parse({id: 'plain', name: 'Timeline title', kind: 'text', track: 'text', start: 0, duration: 30, text: 'LOCAL', fontSize: 44, x: 50, y: 82, color: '#ffcc77', animation: 'rise'}),
  ]};
}

export function textSmokeProject(original: Project): Project {
  const caption = {parentClipId: 'source', highlightColor: '#ffcc33', words: [{text: 'GPU', start: 0, end: 8}, {text: 'captions', start: 8, end: 16}, {text: 'stay', start: 16, end: 24}, {text: 'in sync', start: 24, end: 40}]};
  return {...original, assets: [], clips: [
    clipSchema.parse({id: 'typing', name: 'Cropped typewriter', kind: 'text', track: 'text', start: 0, duration: 30, text: 'GPU\nTypewriter', fontSize: 36, x: 50, y: 4, animation: 'typewriter', crop: {left: 0, right: 18, top: 12, bottom: 0}}),
    clipSchema.parse({id: 'highlight', name: 'Trimmed timed captions', kind: 'text', track: 'text', start: 0, duration: 30, sourceStart: 4, motionOffset: 9, fontSize: 52, x: 50, y: 50, caption: {...caption, style: 'highlight'}, keyframes: {scale: [{frame: 9, value: .8, easing: 'linear'}, {frame: 38, value: 1.1, easing: 'linear'}]}}),
    clipSchema.parse({id: 'boxed', name: 'Boxed captions', kind: 'text', track: 'text', start: 0, duration: 15, fontSize: 30, x: 50, y: 85, caption: {...caption, style: 'boxed'}}),
    clipSchema.parse({id: 'clean', name: 'Clean cropped captions', kind: 'text', track: 'text', start: 15, duration: 15, sourceStart: 15, fontSize: 30, x: 50, y: 85, caption: {...caption, style: 'clean'}, crop: {left: 30, right: 0, top: 0, bottom: 0}}),
  ]};
}

/** Opt-in CPU browser references only. The production native engine never
 * imports this module or starts Chromium. One software browser, tiny frames.
 */
export async function compareArtworkSmoke(output: string, directory: string, project: Project, text = false, referenceFrame?: (frame: number) => Promise<Project>) {
  const serveUrl = await bundle({entryPoint: path.resolve('src/video/index.tsx'), outDir: path.join(directory, 'reference-bundle')});
  const chromiumOptions = {gl: 'swangle' as const};
  const browser = await openBrowser('chrome', {browserExecutable: browserExecutable(), chromiumOptions, logLevel: 'error'});
  const differences: number[] = [];
  try {
    const options = {serveUrl, inputProps: {project: referenceFrame ? await referenceFrame(0) : project, output: {width: 320, height: 180, fit: 'contain'}}, puppeteerInstance: browser, chromiumOptions, offthreadVideoThreads: 1, offthreadVideoCacheSizeInBytes: 16 * 1024 ** 2};
    const composition = await selectComposition({...options, id: 'Project'});
    for(const frame of text ? [0, 3, 6, 16, 29] : [0, 12, 16, 24, 29]) {
      const actual = path.join(directory, `artwork-${frame}.png`); const reference = path.join(directory, `artwork-${frame}-reference.png`);
      await runProcess(ffmpegPath(), ['-v', 'error', '-nostdin', '-threads', '2', '-i', output, '-an', '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-y', actual], 10000);
      await renderStill({...options, ...(referenceFrame ? {inputProps: {...options.inputProps, project: await referenceFrame(frame)}} : {}), composition, frame, output: reference, imageFormat: 'png'});
      for(const region of text ? [{left: 0, top: 0, width: 320, height: 55}, {left: 0, top: 55, width: 320, height: 75}, {left: 0, top: 130, width: 320, height: 50}] : [{left: 60, top: 15, width: 200, height: 90}, {left: 0, top: 100, width: 320, height: 80}]) {
        const a = await sharp(actual).extract(region).removeAlpha().raw().toBuffer();
        const b = await sharp(reference).extract(region).removeAlpha().raw().toBuffer();
        const error = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
        differences.push(error);
        if(error > 12) throw new Error(`GPU asset frame ${frame}, region y=${region.top}, differs from browser reference: ${error.toFixed(2)}.`);
      }
    }
  } finally {await browser.close({silent: true});}
  return differences;
}
