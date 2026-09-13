import {expect, it, vi} from 'vitest';
import type {Font} from 'fontkit';
import {clipSchema} from '../shared/project';
import {createDemo} from '../shared/demo';
import {exportSettingsSchema} from '../shared/media-settings';
import {requireNativeScenePlan} from '../shared/native-scene-plan';
import {GpuFontService, encodeTextLayouts} from '../server/services/rendering/gpu-font-service';
import {captionLayout, prepareGpuText, titleStates} from '../server/services/rendering/gpu-text-service';

const settings = exportSettingsSchema.parse({renderer: 'native-vulkan', encoder: 'amd', width: 320, height: 180, fps: 30});
const title = (patch = {}) => clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 0, duration: 30, text: 'GPU\nEditing', animation: 'typewriter', fontSize: 40, ...patch});
const scene = (clip: ReturnType<typeof title>, options = settings) => requireNativeScenePlan({...createDemo(), assets: [], clips: [clip], width: 640, height: 360, fps: 30}, options);
function fonts() {
  const fonts = new GpuFontService();
  vi.spyOn(fonts, 'font').mockResolvedValue({unitsPerEm: 1000, ascent: 800, descent: -200, familyName: 'Fixture', hasGlyphForCodePoint: () => true,
    layout: (text: string) => ({glyphs: [...text].map(char => ({path: {commands: char === ' ' ? [] : [{command: 'moveTo', args: [0, 0]}, {command: 'lineTo', args: [500, 0]}, {command: 'lineTo', args: [500, 700]}, {command: 'lineTo', args: [0, 700]}, {command: 'closePath', args: []}]}})), positions: [...text].map(() => ({xAdvance: 600, xOffset: 0, yOffset: 0}))}),
  } as unknown as Font);
  return fonts;
}

it('prepares only visible substring states at the original split/range clock', () => {
  const clip = title({text: 'An unfinished typewriter title', motionOffset: 3, duration: 10000});
  const plan = scene(clip, {...settings, startSeconds: .1, endSeconds: .2});
  expect(titleStates(plan, clip, 30)).toEqual([9, 10, 12]);
  const done = title({text: 'Done', motionOffset: 10000, duration: 864000});
  expect(titleStates(scene(done), done, 30)).toEqual([4]);
});

it('keeps prefix box dimensions, multiline alignment and empty first frame in one GPU geometry buffer', async () => {
  const font = fonts(); const clip = title({duration: 5, crop: {left: 0, right: 25, top: 10, bottom: 0}});
  const layout = await font.layout('GPU\nE', '800', 'center', 40);
  expect(layout.width).toBeCloseTo(2.22); expect(layout.height).toBe(2.04);
  expect(layout.shapes[3].bounds[0]).toBeCloseTo(-.37);
  expect((await font.layout('GPU\n', '800', 'center', 40)).height).toBe(1.02);
  const empty = await font.layout('', '800', 'center', 40);
  const encoded = encodeTextLayouts([empty, layout], 'title');
  const data = Buffer.from(encoded.texture.split('\n').find(line => /^[\da-f]+$/.test(line))!, 'hex');
  expect(data.readFloatLE(0)).toBe(data.readFloatLE(4)); // Empty state has no glyph nodes.
  expect(data.readFloatLE(24)).toBeCloseTo(layout.width);
  const program = await prepareGpuText(font, scene(clip), clip, 30, 640);
  expect(program.textures).toHaveLength(1);
  expect(program.functions.join('\n')).toContain('fc_title_outline_box(state)*fs');
});

it('wraps captions with their source intervals, including overlapping highlights after a trim', async () => {
  const clip = title({fontSize: 40, sourceStart: 10, motionOffset: 3, duration: 20, caption: {parentClipId: 'v', style: 'highlight', highlightColor: '#ffaa00', words: [
    {text: 'Gone', start: 0, end: 10}, {text: 'One', start: 9, end: 20}, {text: 'Two', start: 18, end: 25}, {text: 'Later', start: 30, end: 40},
  ]}});
  const {layout} = await captionLayout(fonts(), clip, 200);
  expect(layout.shapes).toHaveLength(6);
  expect(layout.shapes.slice(0, 3).every(shape => shape.start === 9 && shape.end === 20)).toBe(true);
  expect(layout.shapes.slice(3).every(shape => shape.start === 18 && shape.end === 25)).toBe(true);
  expect(layout.height).toBe(1.4);
  const wrapped = await captionLayout(fonts(), {...clip, caption: {...clip.caption!, style: 'boxed'}}, 200);
  expect(wrapped.layout.height).toBe(2.8); expect(wrapped.boxes).toHaveLength(2);
  const program = await prepareGpuText(fonts(), scene(clip), clip, 30, 640);
  expect(program.functions.join('\n')).toContain('state,f+7.0');
  expect(program.functions.join('\n')).not.toContain('q.y-=(1.0-progress)');
});
