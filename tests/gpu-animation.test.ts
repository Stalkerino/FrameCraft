import {expect, it} from 'vitest';
import {clipSchema} from '../shared/project';
import {createDemo} from '../shared/demo';
import {exportSettingsSchema} from '../shared/media-settings';
import {requireNativeScenePlan, nativeScenePlan} from '../shared/native-scene-plan';
import {gpuAnimationShader, gpuKeyframeFunction} from '../shared/gpu-animation';
import {continuousVisualSpans} from '../shared/native-visual-spans';
import {vulkanBatches, vulkanBatchGraph} from '../server/services/rendering/vulkan-batch-service';

const settings = exportSettingsSchema.parse({renderer: 'native-vulkan', encoder: 'amd', width: 320, height: 180, fps: 30});
const project = () => ({...createDemo(), width: 640, height: 360, fps: 30,
  assets: [{id: 'source', name: 'Source', kind: 'video' as const, src: '/media/source.mp4', width: 640, height: 360, duration: 1, fps: 30}],
  clips: [clipSchema.parse({id: 'first', name: 'First', kind: 'video', track: 'visual', assetId: 'source', start: 0, duration: 15, sourceStart: 15}),
    clipSchema.parse({id: 'second', name: 'Second', kind: 'video', track: 'visual', assetId: 'source', start: 15, duration: 15, transition: 'fade', transitionFrames: 6})]});

it('holds the preceding last frame on the GPU without extending source reads or duplicating audio', () => {
  const scene = requireNativeScenePlan(project(), settings);
  expect(scene.spans.map(span => [span.start, span.duration, span.layers.map(layer => layer.clipId)])).toEqual([[0, 15, ['first']], [15, 6, ['first', 'second']], [21, 9, ['second']]]);
  const held = scene.spans[1].layers[0];
  expect(held.sourceStart).toBe(29);
  expect(held.animation).toMatchObject({held: true, localFrame: 14, opaque: true});
  expect(scene.spans[1].audio.map(layer => layer.clipId)).toEqual(['second']);
  const {graph} = vulkanBatchGraph(vulkanBatches(scene.spans, settings)[0], settings, '#080c0e');
  expect(graph).toContain('trim=end_frame=1,loop=loop=-1');
  expect(graph).not.toMatch(/hwdownload|hwmap/);
});

it.each(['fade', 'slide', 'diagonal', 'pixel'] as const)('admits %s and keeps the local animation clock in ranged exports', transition => {
  const p = project(); p.clips[1].transition = transition; p.clips[1].motionOffset = 50;
  p.clips[1].keyframes = {x: [{frame: 50, value: 20, easing: 'ease-in-out'}, {frame: 65, value: 80, easing: 'linear'}]};
  const scene = requireNativeScenePlan(p, {...settings, startSeconds: 17 / 30, endSeconds: 25 / 30});
  expect(scene.spans[0].layers.map(layer => layer.animation?.localFrame)).toEqual([14, 2]);
  expect(scene.spans[0].layers[1].animation?.clip.motionOffset).toBe(50);
  expect(continuousVisualSpans(scene.spans)).toHaveLength(2);
  const shader = gpuAnimationShader(scene.spans[0].layers[1], settings, '#080c0e');
  expect(shader).toContain('float(frame-1)+2.0');
  expect(shader).toContain('f=local+50.0');
  expect(shader.match(/\/\/!HOOK /g)).toHaveLength(1);
});

it('retains a currently invisible clip that animates into view and accepts rotation keyframes', () => {
  const p = project(); p.clips = [{...p.clips[0], opacity: 0, x: 100, crop: {left: 80, top: 0, right: 0, bottom: 0}, keyframes: {opacity: [{frame: 0, value: 0, easing: 'linear'}, {frame: 10, value: 1, easing: 'linear'}], x: [{frame: 0, value: 100, easing: 'linear'}, {frame: 10, value: 50, easing: 'linear'}]}}];
  expect(requireNativeScenePlan(p, settings).spans[0].layers).toHaveLength(1);
  p.clips[0].keyframes!.rotation = [{frame: 0, value: 0, easing: 'linear'}];
  expect(nativeScenePlan(p, settings).blockers).toEqual([]);
});

it('emits property clamping, hold segments and custom Bézier curves without baking one value per frame', () => {
  const clip = {...project().clips[0], keyframes: {opacity: [{frame: 0, value: 0, easing: 'hold' as const}, {frame: 10, value: .4, easing: 'bezier' as const, bezier: {x1: .2, y1: -2, x2: .7, y2: 3}}, {frame: 100000, value: 1, easing: 'linear' as const}]}};
  const shader = gpuKeyframeFunction('opacity', clip);
  expect(shader).toContain('vec4(0.2,-2.0,0.7,3.0)');
  expect(shader).toContain(',0.0,1.0)');
  expect(shader.length).toBeLessThan(600);
});
