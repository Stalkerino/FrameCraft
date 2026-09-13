import {expect, it} from 'vitest';
import {applyCommand, clipSchema, projectSchema, validateProject} from '../shared/project';
import {canNestSequence, projectForSequence, sequenceAssets} from '../shared/project-sequences';
import {nativeScenePlan, requireNativeScenePlan} from '../shared/native-scene-plan';
import {sceneLayers, sourceLayers} from '../shared/native-sequence-plan';
import {exportSettingsSchema} from '../shared/media-settings';
import {vulkanBatches, vulkanBatchGraph} from '../server/services/rendering/vulkan-batch-service';
import {nativeSceneResources} from '../server/services/rendering/native-scene-resources';
import {sceneAudioGraph} from '../server/services/rendering/vulkan-scene-commands';
import {audioEnvelopeGain} from '../shared/audio-envelope';
import {reframeProject} from '../shared/project-settings';

const source = () => projectSchema.parse({version: 1, id: 'p', name: 'Nested', revision: 0, width: 320, height: 180, fps: 24, backgroundColor: '#0000ff', masterVolume: .8,
  assets: [{id: 'v', name: 'Source', kind: 'video', src: '/media/a.mp4', duration: 20, width: 640, height: 360}],
  clips: [clipSchema.parse({id: 'c', name: 'Cut', kind: 'video', track: 'visual', assetId: 'v', start: 12, duration: 36, sourceStart: 24, volume: .5})]});
const parent = () => applyCommand(source(), {type: 'sequence.create', id: 'parent', name: 'Parent', settings: {width: 640, height: 360, fps: 30, backgroundColor: '#000000', masterVolume: .5}});
const nested = () => applyCommand(parent(), {type: 'sequence.insert', id: 'nest', sequenceId: 'main', start: 10, sourceStart: 15, duration: 60});
const settings = exportSettingsSchema.parse({width: 640, height: 360, fps: 30, renderer: 'native-vulkan', encoder: 'amd'});

it('keeps live references, scoped child dependencies, fixed instance durations and guards cycles/deletion', () => {
  let p = nested(); expect(p.clips[0]).toMatchObject({kind: 'sequence', sequenceId: 'main', duration: 60});
  expect(canNestSequence(p, 'parent')).toBe(false);
  expect(() => applyCommand(p, {type: 'sequence.remove', id: 'main'})).toThrow('used by Parent');
  p = applyCommand(p, {type: 'sequence.open', id: 'main'});
  expect(() => applyCommand(p, {type: 'sequence.insert', id: 'cycle', sequenceId: 'parent', start: 0, sourceStart: 0})).toThrow('cycle');
  p = applyCommand(p, {type: 'clip.update', id: 'c', patch: {duration: 1}});
  p = applyCommand(p, {type: 'sequence.open', id: 'parent'});
  expect(p.clips[0].duration).toBe(60);
  const frozen = projectForSequence(p); expect(frozen.sequences?.[0].clips[0].duration).toBe(1);
  expect(sequenceAssets(frozen).map(asset => asset.id)).toEqual(['v']);
  expect(validateProject(projectSchema.parse(JSON.parse(JSON.stringify(frozen))))).toEqual(frozen);
  expect(() => validateProject({...p, sequences: []})).toThrow('reference does not exist');
});

it('preserves nested source time through split, slip, range edits and FPS conversion', () => {
  let p = nested();
  p = applyCommand(p, {type: 'clip.split', id: 'nest', frame: 25, newId: 'right'});
  expect(p.clips.find(c => c.id === 'right')).toMatchObject({start: 25, sourceStart: 30, duration: 45, motionOffset: 15});
  p = applyCommand(p, {type: 'clip.slip', id: 'right', delta: 5, linked: true});
  expect(p.clips.find(c => c.id === 'right')?.sourceStart).toBe(35);
  p = applyCommand(p, {type: 'timeline.edit-ranges', operation: 'assemble', ranges: [{start: 30, end: 45}]});
  expect(p.clips[0]).toMatchObject({sourceStart: 40, duration: 15});
  const reframed = reframeProject(p, 60);
  expect(reframed.clips[0]).toMatchObject({sourceStart: 80, duration: 30});
  expect(reframed.sequences?.[0].fps).toBe(24);
});

it('composes child canvases into GPU textures before instance effects, without media intermediates', () => {
  let p = nested(); p = applyCommand(p, {type: 'clip.update', id: 'nest', patch: {opacity: .5, rotation: 12, colorGrade: {exposure: 1, contrast: 1, saturation: 1, temperature: 0, tint: 0, gamma: 1, hue: 0}}});
  const plan = requireNativeScenePlan(p, settings); const span = plan.spans.find(span => span.start === 10)!;
  const group = span.layers[0]; const leaf = sourceLayers(span)[0];
  expect(group.scene).toMatchObject({width: 320, height: 180, background: '#0000ff'});
  expect(group.animation?.clip).toMatchObject({opacity: .5, rotation: 12});
  expect(leaf.opacity).toBe(1); expect(leaf.gradeStages).toEqual([]); expect(leaf.sourceStart).toBe(30);
  const batch = vulkanBatches([span], settings)[0]; const compiled = vulkanBatchGraph(batch, settings, plan.background);
  expect(compiled.inputs.map(layer => layer.asset.id)).toEqual(['v']);
  expect(compiled.graph).toContain('w=320:h=180:format=rgba');
  expect(compiled.graph).toContain('[s0_group0]format=pix_fmts=vulkan');
  expect(compiled.graph).toContain('w=640:h=360:format=rgba');
  expect(compiled.graph).not.toMatch(/hwdownload|image2pipe|rawvideo/);
  expect(nativeSceneResources(span, settings).estimatedMiB).toBeGreaterThan(nativeSceneResources(group.scene!.span, settings).estimatedMiB);
  expect(() => nativeSceneResources(span, {width: 8192, height: 8192}, 128)).toThrow('No GPU work was started');
});

it('mixes descendant audio with every parent envelope once and silences the tail beyond the child', () => {
  const p = applyCommand(nested(), {type: 'clip.update', id: 'nest', patch: {volume: .5, audioEnvelope: {duration: 60, offset: 0, fadeIn: 30, fadeOut: 0, keyframes: []}}});
  const plan = requireNativeScenePlan(p, settings); const span = plan.spans.find(span => span.start === 10)!;
  expect(span.audio).toHaveLength(1); const audio = span.audio[0];
  expect(audio.volume).toBe(.4); expect(audio.audioGains).toHaveLength(1); expect(audio.audioGains?.[0].volume).toBe(.25);
  expect(audioEnvelopeGain(audio.audioGains![0].envelope, 15)).toBe(.5);
  const graph = sceneAudioGraph([{segment: audio, file: '/source'}], settings, 48000);
  expect(graph).toContain('volume=0.4'); expect(graph).toContain('0.25');
  const tail = plan.spans.find(span => span.start === 55)!;
  expect(tail.audio).toHaveLength(0); expect(tail.layers[0].scene?.span.layers).toHaveLength(0);
});

it('retains all levels of nesting and gives repeated instances independent source and artwork clocks', () => {
  let p = nested();
  p = applyCommand(p, {type: 'sequence.create', id: 'root', name: 'Root'});
  p = applyCommand(p, {type: 'sequence.insert', id: 'outer1', sequenceId: 'parent', start: 0, sourceStart: 10, duration: 30});
  p = applyCommand(p, {type: 'track.add', track: {id: 'v2', name: 'Video 2', type: 'visual', muted: false, hidden: false}});
  p = applyCommand(p, {type: 'sequence.insert', id: 'outer2', sequenceId: 'parent', trackId: 'v2', start: 0, sourceStart: 20, duration: 30});
  const frozen = projectForSequence(p); expect(frozen.sequences?.map(s => s.id).sort()).toEqual(['main', 'parent']);
  const plan = requireNativeScenePlan(p, settings); const span = plan.spans[0];
  expect(sourceLayers(span).map(layer => layer.sourceStart)).toEqual([30, 40]);
  expect(new Set(sceneLayers(span).map(layer => layer.clipId)).size).toBe(sceneLayers(span).length);
  const graph = vulkanBatchGraph(vulkanBatches([span], settings)[0], settings, plan.background);
  expect(graph.inputs).toHaveLength(2); expect(graph.graph.match(/format=nv12/g)).toHaveLength(1);
  expect(plan.spans[0].audio).toHaveLength(2);
});

it('freezes the complete child scene on an entrance transition hold, without extending audio', () => {
  let p = applyCommand(parent(), {type: 'sequence.insert', id: 'held', sequenceId: 'main', start: 0, sourceStart: 15, duration: 15});
  p = applyCommand(p, {type: 'sequence.insert', id: 'next', sequenceId: 'main', start: 15, sourceStart: 0, duration: 15});
  p = applyCommand(p, {type: 'clip.update', id: 'next', patch: {transition: 'fade', transitionFrames: 6}});
  const plan = nativeScenePlan(p, settings); const span = plan.spans.find(span => span.start === 15)!;
  const held = span.layers.find(layer => layer.clipId === 'held')!;
  expect(held.animation?.held).toBe(true); expect(sourceLayers(held.scene!.span)[0].holdFrame).toBe(true);
  expect(span.audio.some(segment => segment.clipId.startsWith('held/'))).toBe(false);
});

it('exports linked nested XML sequences once, with scoped clip IDs and source-rate trims', async () => {
  const {buildPremiereXml} = await import('../shared/timeline-interchange');
  let p = nested();
  p = applyCommand(p, {type: 'sequence.insert', id: 'second', sequenceId: 'main', start: 70, sourceStart: 0, duration: 30});
  const {xml, report} = buildPremiereXml(p, [{assetId: 'v', name: 'Source', filename: 'a.mp4', src: '/media/a.mp4', pathurl: 'file:///media/a.mp4', fps: 24, duration: 20, width: 640, height: 360, audioChannels: 2, sampleRate: 48000}]);
  expect(xml.match(/<sequence id="sequence-2">/g)).toHaveLength(1);
  expect(xml).toContain('<sequence id="sequence-2"/>');
  expect(xml).toContain('<sequence id="sequence-2"><name>Main</name><duration>60</duration>');
  expect(xml).toContain('<clipitem id="sequence-2_clipitem-1"');
  expect(xml).toContain('<in>12</in><out>60</out>');
  expect(xml).toContain('file:///media/a.mp4');
  expect(report.omittedClips).toBe(0); expect(report.visualClips).toBe(2);
});


it('ignores unsupported child effects outside the instance source range', () => {
  let p = source();
  p = applyCommand(p, {type: 'clip.add', clip: clipSchema.parse({id: 'late', name: 'Later annotation', kind: 'annotation', track: 'text', start: 96, duration: 24,
    annotation: {shape: 'arrow', width: 20, height: 20, stroke: 2, rotation: 0}})});
  p = applyCommand(p, {type: 'sequence.create', id: 'parent', name: 'Parent'});
  p = applyCommand(p, {type: 'sequence.insert', id: 'first-second', sequenceId: 'main', start: 0, sourceStart: 0, duration: 24});
  expect(requireNativeScenePlan(p, {...settings, fps: 24}).blockers).toEqual([]);
});
