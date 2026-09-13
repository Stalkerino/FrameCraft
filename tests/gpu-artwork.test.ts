import {expect, it, vi} from 'vitest';
import {gpuScalar} from '../shared/gpu-artwork';
import {presetDefinitionSchema, scalarAt, type Scalar} from '../shared/asset-presets';
import {clipSchema} from '../shared/project';
import {createDemo} from '../shared/demo';
import {exportSettingsSchema} from '../shared/media-settings';
import {requireNativeScenePlan, nativeScenePlan} from '../shared/native-scene-plan';
import {prepareGpuArtwork} from '../server/services/rendering/gpu-artwork-service';
import {GpuFontService, flattenOutline} from '../server/services/rendering/gpu-font-service';
import {vulkanBatchGraph, vulkanBatches} from '../server/services/rendering/vulkan-batch-service';
import {describeRenderPlan} from '../shared/render-plan';

const settings = exportSettingsSchema.parse({renderer: 'native-vulkan', encoder: 'amd', width: 320, height: 180, fps: 30});
const project = () => ({...createDemo(), width: 640, height: 360, fps: 30, assets: [], clips: [clipSchema.parse({id: 'art', name: 'Recipe', kind: 'graphic', track: 'text', start: 0, duration: 30, graphic: {
  presetId: 'recipe', version: 1, values: {}, duration: 1, definition: presetDefinitionSchema.parse({schemaVersion: 1, name: 'Recipe', category: 'title', layers: [{id: 'rect', type: 'rect'}]}),
}})]});

it.each(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'] as const)('preserves %s recipe interpolation and parameter values at exact key boundaries', easing => {
  const scalar: Scalar = {keyframes: [{at: .1, value: -20}, {at: .4, value: {param: 'end'}}, {at: .9, value: 80}], easing};
  const expression = gpuScalar(scalar, {end: 30});
  const evaluate = new Function('p', 'clamp', 'mix', 'step', `return ${expression}`);
  for(const p of [0, .1, .1001, .25, .4, .4001, .8, .9, 1]) {
    expect(evaluate(p, (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)), (a: number, b: number, t: number) => a + (b - a) * t, (edge: number, value: number) => Number(value >= edge))).toBeCloseTo(scalarAt(scalar, p, {end: 30}), 8);
  }
});

it('plans generated assets without media reads or audio, and preserves library snapshots through GPU compilation', async () => {
  const p = project(); const snapshot = structuredClone(p); const scene = requireNativeScenePlan(p, settings);
  expect(scene.spans[0].audio).toEqual([]);
  const prepared = await prepareGpuArtwork(scene, settings.fps);
  const compiled = vulkanBatchGraph(vulkanBatches(scene.spans, settings)[0], settings, '#080c0e', prepared);
  expect(compiled.inputs).toEqual([]);
  expect(compiled.graph).toContain('color_vulkan=c=black@0');
  expect(compiled.graph).not.toMatch(/hwupload|hwdownload|hwmap/);
  expect(p).toEqual(snapshot);
  expect(describeRenderPlan(p, {settings}).route).toBe('native-vulkan');
});

it('packs forty text layers into one geometry binding before opening a GPU', async () => {
  const p = project();
  p.clips[0].graphic!.definition.layers = Array.from({length: 40}, (_, i) => ({...p.clips[0].graphic!.definition.layers[0], id: `text-${i}`, type: 'text', text: 'GPU'}));
  const spy = vi.spyOn(GpuFontService.prototype, 'outline').mockImplementation(async (_text, _weight, _align, name) => ({binding: `${name}_geometry`, texture: `//!TEXTURE ${name}_geometry\n//!SIZE 1 2\n//!FORMAT rgba32f\n//!FILTER NEAREST\n${'00'.repeat(32)}\n`, function: `float ${name}(vec2 p,float a){return texelFetch(${name}_geometry,ivec2(0,0),0).x;}`, bytes: 32}));
  try {
    const scene = requireNativeScenePlan(p, settings); const programs = await prepareGpuArtwork(scene, settings.fps);
    expect(programs.get('art')!.graphic!.textures).toHaveLength(1);
    expect(programs.get('art')!.graphic!.bindings).toEqual(['fc_asset_geometry']);
    expect(programs.get('art')!.graphic!.functions.join('\n')).toContain('texelFetch(fc_asset_geometry,');
  } finally {spy.mockRestore();}
});

it('retains font contours and holes as bounded geometry without rasterizing a bitmap', () => {
  const edges = flattenOutline([{command: 'moveTo', args: [0, 0]}, {command: 'lineTo', args: [100, 0]}, {command: 'quadraticCurveTo', args: [150, 50, 100, 100]}, {command: 'lineTo', args: [0, 100]}, {command: 'closePath', args: []}], 100);
  expect(edges.length).toBeGreaterThan(4); expect(edges.length).toBeLessThan(512);
  expect(edges[0]).toEqual([0, 0, 1, 0]); expect(edges.at(-1)).toEqual([0, -1, 0, 0]);
});

it('accepts direct titles, typewriter animation and text-box crops', () => {
  const p = project(); p.clips = [clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 0, duration: 30, text: 'Local editing', animation: 'rise'})];
  expect(requireNativeScenePlan(p, settings).spans[0].layers[0].textClip?.text).toBe('Local editing');
  p.clips[0].animation = 'typewriter';
  p.clips[0].crop = {left: 10, right: 20, top: 0, bottom: 0};
  expect(nativeScenePlan(p, settings).blockers).toEqual([]);
});
