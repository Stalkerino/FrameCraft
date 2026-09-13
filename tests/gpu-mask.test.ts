import {expect, it} from 'vitest';
import {clipSchema} from '../shared/project';
import {maskSchema} from '../shared/visual-editing';
import {createDemo} from '../shared/demo';
import {exportSettingsSchema} from '../shared/media-settings';
import {nativeScenePlan, requireNativeScenePlan} from '../shared/native-scene-plan';
import {gpuAnimationShader, gpuKeyframeFunction} from '../shared/gpu-animation';
import {gaussianQuadrature, gpuMaskShader} from '../shared/gpu-mask';
import {maskGeometry, nativeMaskVertexBudget} from '../shared/mask-geometry';

const settings = exportSettingsSchema.parse({renderer: 'native-vulkan', encoder: 'amd', width: 320, height: 180, fps: 30});
const video = clipSchema.parse({id: 'v', name: 'Video', kind: 'video', track: 'visual', assetId: 'a', start: 0, duration: 30, rotation: -35, motionOffset: 4});
const project = () => ({...createDemo(), width: 640, height: 360, fps: 30, assets: [{id: 'a', name: 'Source', kind: 'video' as const, src: '/media/a.mp4', width: 640, height: 360, duration: 1, fps: 30}], clips: [structuredClone(video)]});

it('preserves static/keyed rotation and the mask snapshot across ranged GPU planning', () => {
  const p = project(); p.clips[0].mask = maskSchema.parse({shape: 'ellipse', feather: 32, inverted: true});
  p.clips[0].keyframes = {rotation: [{frame: 4, value: -35, easing: 'hold'}, {frame: 20, value: 135, easing: 'linear'}]};
  const scene = requireNativeScenePlan(p, {...settings, startSeconds: .2, endSeconds: .8});
  const layer = scene.spans[0].layers[0];
  expect(layer.animation).toMatchObject({localFrame: 6, clip: {rotation: -35, motionOffset: 4, mask: p.clips[0].mask}});
  const shader = gpuAnimationShader(layer, settings, '#080c0e');
  expect(shader).toContain('fc_rotation(f)'); expect(shader).toContain('c*=maskAlpha');
  expect(shader.match(/\/\/!HOOK /g)).toHaveLength(1);
  expect(shader).not.toMatch(/hwdownload|hwmap/);
  expect(gpuKeyframeFunction('rotation', video)).toContain('return -35.0;');
});

it('uses the SVG viewBox, shape bounds and Gaussian sigma before transforms', () => {
  const mask = maskSchema.parse({shape: 'polygon', feather: 48, points: [{x: 10, y: 20}, {x: 80, y: 30}, {x: 45, y: 90}]});
  expect(maskGeometry(mask, {width: 640, height: 360})).toMatchObject({sigma: 24, bounds: {left: 64, top: 72, right: 512, bottom: 324}});
  const shader = gpuMaskShader(mask, {width: 640, height: 360});
  expect(shader).toContain('winding!=0'); // SVG nonzero fill, including self crossings.
  expect(shader).toContain('fc_mask_cdf');
  expect(shader).not.toContain('//!TEXTURE'); // No raster mask upload.
});

it('normalizes Gaussian quadrature and integrates constant, quadratic and Gaussian kernels', () => {
  const taps = gaussianQuadrature();
  const integral = (fn: (x: number) => number) => taps.reduce((sum, [x, w]) => sum + w * fn(x), 0);
  expect(integral(() => 1)).toBeCloseTo(2, 12);
  expect(integral(x => x * x)).toBeCloseTo(2 / 3, 12);
  expect(integral(x => 4 * Math.exp(-.5 * (4 * x) ** 2) / Math.sqrt(2 * Math.PI))).toBeCloseTo(.9999366575, 9);
});

it('rejects excessive polygon work in planning without restricting the editing schema', () => {
  const p = project(); p.clips[0].mask = maskSchema.parse({shape: 'polygon', points: Array.from({length: nativeMaskVertexBudget + 1}, (_, i) => ({x: 50 + 40 * Math.cos(i), y: 50 + 40 * Math.sin(i)}))});
  expect(nativeScenePlan(p, settings).blockers).toContainEqual(expect.objectContaining({code: 'mask-complexity', clipId: 'v'}));
  expect(() => gpuMaskShader(p.clips[0].mask!, p)).toThrow('128 vertices');
});

it('keeps degenerate masks empty (or full when inverted) without dividing by zero', () => {
  const mask = maskSchema.parse({shape: 'polygon', inverted: true, feather: 50, points: [{x: 50, y: 10}, {x: 50, y: 50}, {x: 50, y: 90}]});
  const shader = gpuMaskShader(mask, {width: 640, height: 360});
  expect(shader).not.toContain('fc_mask_blur'); expect(shader).toContain('return 1.0-coverage;');
});
