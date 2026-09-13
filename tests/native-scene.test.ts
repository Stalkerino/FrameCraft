import {describe, expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {defaultTracks} from '../shared/tracks';
import {nativeScenePlan, requireNativeScenePlan} from '../shared/native-scene-plan';
import {outputVideoPlacement} from '../shared/composition-layout';
import {vulkanPipeline} from '../server/services/rendering/vulkan-pipeline-service';
import {vulkanSceneGraph, vulkanSceneVideoArguments, sceneAudioArguments, sceneAudioGraph} from '../server/services/rendering/vulkan-scene-commands';
import {nativeSceneResources} from '../server/services/rendering/native-scene-resources';
import {describeRenderPlan} from '../shared/render-plan';
import {colorGradeSchema, colorGradeStages} from '../shared/color-grading';

function fixture() {
  const asset = {id: 'rush', name: 'Rush', kind: 'video' as const, src: '/media/rush.mp4', width: 640, height: 360, fps: 30, duration: 10};
  const project = {...createDemo(), width: 640, height: 360, fps: 30, assets: [asset], backgroundColor: '#18212a',
    tracks: [{id: 'upper', type: 'visual' as const, name: 'Video 2', hidden: false, muted: false}, ...defaultTracks], clips: [
      clipSchema.parse({id: 'left', name: 'Left', kind: 'video', track: 'visual', assetId: asset.id, start: 0, duration: 20, scale: .5, x: 25, sourceStart: 30}),
      clipSchema.parse({id: 'right', name: 'Right', kind: 'video', track: 'visual', trackId: 'upper', assetId: asset.id, start: 0, duration: 10, scale: .5, x: 75, sourceStart: 90,
        audioEnvelope: {duration: 10, fadeOut: 5}}),
    ]};
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-vulkan', encoder: 'amd'});
  return {project, settings, asset};
}

it('sweeps source changes and empty intervals in painter order while retaining both audio tracks', () => {
  const {project, settings} = fixture();
  const before = structuredClone(project); const scene = requireNativeScenePlan(project, settings);
  expect(scene.spans.map(span => [span.start, span.duration, span.layers.map(layer => layer.clipId)])).toEqual([
    [0, 10, ['left', 'right']], [10, 10, ['left']], [20, 10, []],
  ]);
  expect(scene.spans[0].audio.map(layer => layer.clipId)).toEqual(['left', 'right']);
  expect(scene.spans[1].layers[0].sourceStart).toBe(40);
  expect(scene.spans[0].layers.map(layer => layer.placement.destination)).toEqual([
    {x: 0, y: 45, width: 160, height: 90}, {x: 160, y: 45, width: 160, height: 90},
  ]);
  expect(scene.spans[2].audio).toEqual([]);
  expect(describeRenderPlan(project, {settings}).route).toBe('native-vulkan');
  expect(project).toEqual(before);
});

it('clips source crop and output cover without stretching and preserves subpixel placement', () => {
  const {project, settings, asset} = fixture();
  const clipped = {...project.clips[1], crop: {left: 25, right: 0, top: 0, bottom: 0}};
  expect(outputVideoPlacement(clipped, asset, project, settings)).toEqual({source: {x: 160, y: 0, width: 480, height: 360}, destination: {x: 200, y: 45, width: 120, height: 90}});
  const full = {...project.clips[0], scale: 1, x: 50};
  const square = outputVideoPlacement(full, asset, project, {...settings, width: 180, height: 180, fit: 'cover'});
  expect(square).toEqual({source: {x: 140, y: 0, width: 360, height: 360}, destination: {x: 0, y: 0, width: 180, height: 180}});
  expect(outputVideoPlacement(full, asset, project, {...settings, width: 180, height: 180, fit: 'contain'})?.destination).toEqual({x: 0, y: 39.375, width: 180, height: 101.25});
});

it('retains separate audio, excludes hidden tracks, preserves ranged envelopes and rejects unimplemented effects', () => {
  const {project, settings} = fixture();
  const ranged = requireNativeScenePlan(project, {...settings, startSeconds: .1, endSeconds: .3});
  expect(ranged.spans[0].audio[1].audioEnvelope?.offset).toBe(3);
  project.tracks[0].hidden = true;
  project.clips[1].mask = {shape: 'ellipse', x: 50, y: 50, width: 100, height: 100, points: [], inverted: false, feather: 0};
  expect(nativeScenePlan(project, settings).blockers).toEqual([]);
  project.tracks[0].hidden = false;
  expect(requireNativeScenePlan(project, settings).spans[0].layers.find(layer => layer.clipId === 'right')?.animation?.clip.mask?.shape).toBe('ellipse');
  project.clips[1].mask = null; project.clips[1].trackId = 'visual';
  expect(() => requireNativeScenePlan(project, settings)).toThrow('separate tracks');
});

describe.each(['linux', 'win32'] as const)('%s Vulkan contract', platform => {
  it.each(['amd', 'nvidia'] as const)('keeps %s decoding, canvas, composition and encoding in one Vulkan device', vendor => {
    const {project, settings} = fixture(); const span = requireNativeScenePlan(project, settings).spans[0];
    const pipeline = vulkanPipeline('ffmpeg', 'h264', vendor, platform);
    const graph = vulkanSceneGraph(span, settings, project.backgroundColor);
    const args = vulkanSceneVideoArguments(span, settings, ['C:\\User media\\first.mp4', '/media/second.mp4'], 'C:\\User media\\graph.txt', 'out.nut', pipeline);
    expect(args).toContain(`vulkan=fc:${vendor === 'amd' ? 'AMD' : 'NVIDIA'}`);
    expect(args.filter(arg => arg === '-hwaccel')).toHaveLength(2);
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('+vulkan');
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe('C:\\User media\\graph.txt');
    expect(args[args.indexOf('-c:v') + 1]).toBe('h264_vulkan');
    expect(graph).toContain('color_vulkan=');
    expect(graph).toContain('[canvas][layer0][layer1]libplacebo=inputs=3');
    expect(graph).toContain('pos_x=\'eq(idx,0)*0+eq(idx,1)*0+eq(idx,2)*160\'');
    expect(args.concat(graph).join(' ')).not.toMatch(/hwupload|hwdownload|hwmap|vaapi|nvenc|amf|\.png|\bscale=/);
    expect(args).toContain('-noauto_conversion_filters');
  });
});

it('mixes without amplitude renormalization and rejects excessive estimated GPU memory before execution', () => {
  const {project, settings} = fixture(); const scene = requireNativeScenePlan(project, settings); const span = scene.spans[0];
  const inputs = span.audio.map(segment => ({segment, file: 'rush.mp4'}));
  const audio = sceneAudioArguments(inputs, settings, 'audio.txt', 'audio.wav');
  expect(audio.filter(arg => arg === '-vn')).toHaveLength(3);
  expect(audio[audio.indexOf('-/filter_complex') + 1]).toBe('audio.txt');
  expect(sceneAudioGraph(inputs, settings, 16000)).toContain('amix=inputs=2:normalize=0');
  expect(sceneAudioGraph(inputs, settings, 16000)).toContain('atrim=end_sample=16000');
  expect(nativeSceneResources(span, settings).estimatedMiB).toBeLessThan(128);
  const large = {...span, layers: span.layers.map(layer => ({...layer, asset: {...layer.asset, width: 7680, height: 4320}}))};
  expect(() => nativeSceneResources(large, {...settings, width: 7680, height: 4320}, 1024)).toThrow('No GPU work was started');
});

it('selects a named device within the requested vendor instead of accidentally using its other GPU', () => {
  expect(vulkanPipeline('ffmpeg', 'h264', 'amd', 'linux', 'AMD Radeon RX 9070 XT').initialize).toContain('vulkan=fc:AMD Radeon RX 9070 XT');
  expect(() => vulkanPipeline('ffmpeg', 'h264', 'amd', 'win32', 'NVIDIA')).toThrow('AMD');
});

it('retains image duration, orders clip/global grades and uploads a still only before GPU looping', () => {
  const {project: base, settings} = fixture();
  const image = {...base.assets[0], id: 'image', kind: 'image' as const, duration: 1 / 30, src: '/media/image.png'};
  const clip = clipSchema.parse({...base.clips[1], kind: 'image', assetId: image.id, duration: 30, sourceStart: 900, opacity: .4, colorGrade: {exposure: 1}});
  const project = {...base, colorGrade: colorGradeSchema.parse({gamma: .8}), assets: [...base.assets, image], clips: [base.clips[0], clip]};
  const scene = requireNativeScenePlan(project, settings); const span = scene.spans[0];
  expect(span.layers[1].gradeStages).toEqual(colorGradeStages(clip.colorGrade, project.colorGrade));
  expect(span.layers[1].opacity).toBe(.4);
  expect(scene.spans.at(-1)?.layers[0].asset.kind).toBe('image');
  expect(span.audio.map(clip => clip.asset.kind)).toEqual(['video']);
  const graph = vulkanSceneGraph(span, settings, project.backgroundColor);
  expect(graph).toContain('format=rgba,hwupload,loop=loop=-1:size=1');
  expect(graph).toContain('custom_shader_bin=');
  expect(graph).not.toContain('hwdownload');
  const args = vulkanSceneVideoArguments(span, settings, ['video.mp4', 'image.rgba'], 'graph.txt', 'out.nut', vulkanPipeline('ffmpeg', 'h264', 'amd'));
  expect(args.filter(value => value === '-hwaccel')).toHaveLength(1);
  expect(args.filter(value => value === '-ss')).toHaveLength(1);
  expect(args).toContain('rawvideo');
  const invisible = {...project, clips: [{...project.clips[0], opacity: 0}]};
  expect(requireNativeScenePlan(invisible, settings).spans[0].layers).toEqual([]);
  expect(requireNativeScenePlan(invisible, settings).spans[0].audio).toHaveLength(1);
});
