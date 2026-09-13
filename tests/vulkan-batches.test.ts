import {expect, it} from 'vitest';
import {exportSettingsSchema} from '../shared/media-settings';
import {continuousVisualSpans} from '../shared/native-visual-spans';
import {createDemo} from '../shared/demo';
import {requireNativeScenePlan} from '../shared/native-scene-plan';
import {vulkanBatches, vulkanBatchGraph} from '../server/services/rendering/vulkan-batch-service';
import {nativeSceneResources} from '../server/services/rendering/native-scene-resources';
import {effectsSmokeProject} from '../scripts/vulkan-smoke-scene';

const settings = exportSettingsSchema.parse({renderer: 'native-vulkan', encoder: 'amd', width: 320, height: 180, fps: 30});
const spans = () => requireNativeScenePlan(effectsSmokeProject({...createDemo(), width: 640, height: 360, fps: 30,
  assets: [{id: 'source', kind: 'video', name: 'Source', src: '/media/source.mp4', duration: 1, width: 640, height: 360, fps: 30}]}), settings).spans;

it('coalesces audio-only boundaries without changing the source plan; discontinuous source cuts stay separate', () => {
  const first = spans()[0];
  const next = {...first, start: first.start + first.duration, layers: first.layers.map(layer => ({...layer, sourceStart: layer.sourceStart + first.duration}))};
  const input = [first, next]; const before = JSON.stringify(input);
  const merged = continuousVisualSpans(input);
  expect(merged).toHaveLength(1);
  expect(merged[0].duration).toBe(first.duration * 2);
  expect(merged[0].audio).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
  next.layers = next.layers.map(layer => layer.asset.kind === 'video' ? {...layer, sourceStart: layer.sourceStart + 1} : layer);
  expect(continuousVisualSpans(input)).toHaveLength(2);
});

it('admits all concurrent branches within the estimated budget and caps the number of scenes', () => {
  const input = spans();
  const budgets = input.map(span => nativeSceneResources(span, settings, 1024).estimatedMiB);
  const groups = vulkanBatches(input, settings, {budgetMiB: Math.max(128, ...budgets), maxSpans: 4});
  expect(groups).toHaveLength(3);
  expect(groups.reduce((sum, batch) => sum + batch.duration, 0)).toBe(30);
  expect(vulkanBatches(input, settings, {budgetMiB: 1024, maxSpans: 2}).map(batch => batch.spans.length)).toEqual([2, 1]);
  expect(() => vulkanBatches(input, settings, {maxSpans: 99})).toThrow('1 to 8');
});

it('uploads a shared image once and applies its static shader before splitting the GPU texture into scene loops', () => {
  const [batch] = vulkanBatches(spans(), settings, {budgetMiB: 1024, maxSpans: 4});
  const {graph, inputs} = vulkanBatchGraph(batch, settings, '#18212a');
  expect(inputs.filter(layer => layer.asset.kind === 'image')).toHaveLength(1);
  expect(graph.match(/hwupload/g)).toHaveLength(1);
  expect(graph.indexOf('custom_shader_bin')).toBeLessThan(graph.indexOf('loop=loop=-1'));
  expect(graph).toContain('split=3[image_0_');
  expect(graph).toContain('concat=n=3:v=1:a=0,format=pix_fmts=vulkan');
  expect(graph).not.toMatch(/hwdownload|hwmap/);
});
