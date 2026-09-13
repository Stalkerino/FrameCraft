import path from 'node:path';
import sharp from 'sharp';
import {clipSchema, type Project} from '../shared/project';
import {defaultTracks, trackClips, projectTracks} from '../shared/tracks';
import {visualStateAtFrame} from '../shared/visual-editing';
import {zoomAtFrame} from '../shared/clip-animation';
import {transitionHold, transitionProgress, transitionGeometry as geometry} from '../shared/transition-timing';
import {ffmpegPath, runProcess} from '../server/services/process-service';
import {effectsImagePixels, effectsImage} from './vulkan-smoke-scene';

export function animationSmokeProject(original: Project): Project {
  return {...original, backgroundColor: '#18212a', tracks: [{id: 'image-top', name: 'Animated image', type: 'visual', muted: false, hidden: false}, ...defaultTracks],
    assets: [...original.assets, {id: 'image', name: 'RGBA test', kind: 'image', src: '/media/image.png', width: 640, height: 360, duration: 1 / 30}],
    clips: [
      ...(['none', 'fade', 'slide', 'diagonal', 'pixel'] as const).map((transition, index) => clipSchema.parse({id: `scene-${index}`, name: transition, kind: 'video', track: 'visual', assetId: 'source', start: index * 6, duration: 6, sourceStart: 24 - index * 6, transition, transitionFrames: 5, volume: .3})),
      clipSchema.parse({id: 'image', name: 'Animated RGBA', kind: 'image', track: 'visual', trackId: 'image-top', assetId: 'image', start: 0, duration: 30,
        scale: .3, opacity: .7, y: 25, motionOffset: 5, crop: {left: 10, top: 5, right: 0, bottom: 0},
        zoom: {from: 1, to: 1.3, x: 20, y: 70, start: 5, end: 34},
        keyframes: {x: [{frame: 5, value: 20, easing: 'bezier', bezier: {x1: .2, y1: -.2, x2: .7, y2: 1.2}}, {frame: 34, value: 80}],
          y: [{frame: 5, value: 25, easing: 'hold'}, {frame: 20, value: 70}],
          scale: [{frame: 5, value: .3, easing: 'ease-in-out'}, {frame: 34, value: .6}],
          opacity: [{frame: 5, value: 0, easing: 'ease-out'}, {frame: 20, value: .7}, {frame: 34, value: .3}]} }),
    ]};
}

/** Independent CPU reference in the opt-in harness only. Sample interior
 * pixels using preview transforms/timing; native export never reads pixels
 * back. Sharp/FFmpeg decode at most these tiny fixtures into bounded buffers.
 */
export async function compareAnimationSmoke(output: string, source: string, directory: string, project: Project) {
  const differences: number[] = []; const textures = new Map<number, Buffer>();
  const rawImage = effectsImagePixels();
  const decode = async (file: string, frame: number, name: string) => {
    const png = path.join(directory, name);
    await runProcess(ffmpegPath(), ['-v', 'error', '-nostdin', '-threads', '2', '-i', file, '-an', '-vf', `select=eq(n\\,${frame}),format=rgb24`, '-frames:v', '1', '-y', png], 10000);
    return sharp(png).ensureAlpha().raw().toBuffer();
  };
  const tracks = [...projectTracks(project)].filter(track => !track.hidden).reverse();
  const bottom = tracks.find(track => track.type === 'visual')!.id;
  const background = [24, 33, 42];
  for(const frame of [0, 6, 8, 12, 14, 18, 20, 24, 26, 29]) {
    const actual = await decode(output, frame, `animation-${frame}.png`);
    const layers: {clip: Project['clips'][number]; local: number; opaque: boolean; pixels: Buffer}[] = [];
    for(const track of tracks.filter(track => track.type === 'visual')) {
      const clips = trackClips(project, track.id);
      for(const [index, clip] of clips.entries()) {
        if(frame < clip.start || frame >= clip.start + clip.duration + transitionHold(clip, clips[index + 1])) continue;
        const local = Math.min(frame - clip.start, clip.duration - 1);
        const sourceFrame = clip.sourceStart + local;
        if(clip.kind === 'video' && !textures.has(sourceFrame)) textures.set(sourceFrame, await decode(source, sourceFrame, `source-${sourceFrame}.png`));
        layers.push({clip: {...clip, ...visualStateAtFrame(clip, local)}, local, opaque: track.id === bottom, pixels: clip.kind === 'image' ? rawImage : textures.get(sourceFrame)!});
      }
    }
    const reference = Buffer.alloc(320 * 180 * 3); let sum = 0; let count = 0;
    for(let y = 0; y < 180; y++) for(let x = 0; x < 320; x++) {
      let rgb = [...background]; let edge = false;
      for(const {clip, local, opaque, pixels} of layers) {
        let px = (x + .5) * 2; const py = (y + .5) * 2;
        const p = transitionProgress(clip, local);
        if(clip.transition === 'slide') px -= (1 - p) * 640;
        if(px < 0 || px >= 640) continue;
        const boundary = clip.transition === 'diagonal' ? p * geometry.diagonalReach - geometry.diagonalSlope * py / 360
          : clip.transition === 'pixel' && p < 1 ? Math.max(0, Math.min(1, Math.floor((p * geometry.pixelReach - Math.floor(py / 360 * geometry.pixelRows) * geometry.pixelPhase % geometry.pixelPeriod) * 10) / 100)) : 1;
        if(Math.abs(px / 640 - boundary) < .02) edge = true;
        if(px / 640 >= boundary) continue;
        const scale = clip.scale * zoomAtFrame(clip, local);
        const ox = (clip.zoom?.x ?? 50) / 100 * 640; const oy = (clip.zoom?.y ?? 50) / 100 * 360;
        const sx = (px - (clip.x / 100 - .5) * 640 - ox) / scale + ox;
        const sy = (py - (clip.y / 100 - .5) * 360 - oy) / scale + oy;
        const crop = clip.crop ?? {left: 0, right: 0, top: 0, bottom: 0};
        const bounds = [sx - crop.left / 100 * 640, 640 * (1 - crop.right / 100) - sx, sy - crop.top / 100 * 360, 360 * (1 - crop.bottom / 100) - sy];
        if(bounds.some(v => Math.abs(v * scale) < 4)) edge = true;
        let alpha = 0; let color = [0, 0, 0];
        if(sx >= 0 && sx < 640 && sy >= 0 && sy < 360 && bounds.every(v => v >= 0)) {
          const i = (Math.floor(sy) * 640 + Math.floor(sx)) * 4;
          alpha = pixels[i + 3] / 255; color = [pixels[i], pixels[i + 1], pixels[i + 2]];
        }
        if(opaque) {color = color.map((c, i) => c * alpha + background[i] * (1 - alpha)); alpha = 1;}
        alpha *= clip.opacity * (clip.transition === 'fade' ? p : 1);
        rgb = rgb.map((c, i) => c * (1 - alpha) + color[i] * alpha);
      }
      rgb.forEach((c, channel) => {reference[(y * 320 + x) * 3 + channel] = Math.round(c);});
      if(!edge) {for(let c = 0; c < 3; c++) sum += Math.abs(rgb[c] - actual[(y * 320 + x) * 4 + c]); count += 3;}
    }
    await sharp(reference, {raw: {width: 320, height: 180, channels: 3}}).png().toFile(path.join(directory, `animation-${frame}-reference.png`));
    const error = sum / count; differences.push(error);
    if(!Number.isFinite(error) || error > 12) throw new Error(`Animation frame ${frame} differs from preview reference: ${error.toFixed(2)} mean pixel error.`);
  }
  return differences;
}
