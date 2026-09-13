import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {clipSchema, type Project} from '../shared/project';
import {maskSchema} from '../shared/visual-editing';
import {defaultTracks} from '../shared/tracks';
import {presetDefinitionSchema} from '../shared/asset-presets';
import {runProcess, ffmpegPath} from '../server/services/process-service';
import {compareArtworkSmoke} from './vulkan-artwork-smoke';

export function maskSmokeProject(original: Project): Project {
  return {...original, backgroundColor: '#18212a', tracks: [{id: 'image', name: 'Image', type: 'visual', muted: false, hidden: false}, ...defaultTracks],
    assets: [...original.assets, {id: 'image', kind: 'image', name: 'RGBA', src: '/media/image.png', width: 640, height: 360, duration: 1}],
    clips: [
      clipSchema.parse({id: 'video', name: 'Rotated masked video', kind: 'video', track: 'visual', assetId: 'source', start: 0, duration: 30, x: 25, y: 30, scale: .45, mask: maskSchema.parse({shape: 'ellipse', width: 80, height: 70, feather: 18}), keyframes: {rotation: [{frame: 0, value: -20, easing: 'ease-in-out'}, {frame: 29, value: 35, easing: 'linear'}]}}),
      clipSchema.parse({id: 'image', name: 'Inverted crossing polygon', kind: 'image', track: 'visual', trackId: 'image', assetId: 'image', start: 0, duration: 30, x: 75, y: 30, scale: .45, rotation: -22, mask: maskSchema.parse({shape: 'polygon', inverted: true, feather: 24, points: [{x: 20, y: 10}, {x: 80, y: 90}, {x: 20, y: 90}, {x: 80, y: 10}]})}),
      clipSchema.parse({id: 'graphic', name: 'Soft rectangle', kind: 'graphic', track: 'text', start: 0, duration: 30, x: 32, y: 76, scale: .5, rotation: 25, mask: maskSchema.parse({shape: 'rectangle', width: 65, height: 60, feather: 40}), graphic: {presetId: 'mask-test', version: 1, values: {}, duration: 1, definition: presetDefinitionSchema.parse({schemaVersion: 1, name: 'Mask test', category: 'background', layers: [{id: 'bg', type: 'rect', width: 100, height: 100, fill: '#0077cc'}]})}}),
      clipSchema.parse({id: 'title', name: 'Dynamic text box', kind: 'text', track: 'text', start: 0, duration: 30, x: 32, y: 63, fontSize: 44, animation: 'typewriter', text: 'MASK\nROTATE', crop: {left: 10, top: 0, right: 0, bottom: 0}, mask: maskSchema.parse({shape: 'ellipse', width: 90, height: 90, feather: 20}), keyframes: {rotation: [{frame: 0, value: 20, easing: 'linear'}, {frame: 29, value: -20, easing: 'linear'}]}}),
      clipSchema.parse({id: 'caption', name: 'Masked caption', kind: 'text', track: 'text', start: 0, duration: 30, x: 74, y: 84, fontSize: 28, rotation: -8, mask: maskSchema.parse({shape: 'polygon', points: [{x: 5, y: 0}, {x: 100, y: 30}, {x: 50, y: 100}]}), caption: {parentClipId: 'video', style: 'highlight', highlightColor: '#ffcc33', words: [{text: 'Caption', start: 0, end: 15}, {text: 'mask', start: 15, end: 30}]}}),
      clipSchema.parse({id: 'rise', name: 'Rotated rise', kind: 'text', track: 'text', start: 0, duration: 30, x: 50, y: 3, align: 'right', scale: .8, fontSize: 26, text: 'RISE', animation: 'rise', rotation: 30}),
    ]};
}

/** CPU reference extraction is confined to this opt-in 30-frame harness.
 * Replacing video with its exact source frame exercises the same CSS geometry
 * without starting another video decoder in the reference browser.
 */
export async function compareMaskSmoke(output: string, directory: string, project: Project) {
  const image = `data:image/png;base64,${(await readFile(path.join(directory, 'media/image.png'))).toString('base64')}`;
  return compareArtworkSmoke(output, directory, project, true, async frame => {
    const file = path.join(directory, `mask-source-${frame}.png`);
    await runProcess(ffmpegPath(), ['-v', 'error', '-nostdin', '-threads', '2', '-i', path.join(directory, 'media/source.mp4'), '-an', '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-y', file], 10000);
    const source = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
    return {...project, assets: project.assets.map(asset => ({...asset, kind: 'image' as const, src: asset.id === 'source' ? source : image})), clips: project.clips.map(clip => clip.kind === 'video' ? {...clip, kind: 'image' as const} : clip)};
  });
}
