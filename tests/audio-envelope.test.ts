import {expect, it} from 'vitest';
import {audioEnvelopeGain, audioEnvelopeSchema, audioVolumeFilter, keyframeGain} from '../shared/audio-envelope';
import {duckingKeyframes} from '../shared/audio-ducking';
import {applyCommand, clipSchema, type Project} from '../shared/project';
import {reframeProject} from '../shared/project-settings';
import {removeTimelineRanges} from '../shared/assisted-editing';
import {layeredRenderPlan} from '../shared/layered-render-plan';
import {exportSettingsSchema} from '../shared/media-settings';
import {ffmpegPath, runProcess} from '../server/services/process-service';

function fixture(): Project {
  return {version: 1, id: 'audio-test', name: 'Audio test', revision: 0, width: 128, height: 72, fps: 24,
    assets: [{id: 'source', name: 'Source', kind: 'video', src: '/media/source.mp4', width: 128, height: 72, duration: 8}],
    clips: [clipSchema.parse({id: 'clip', name: 'Clip', kind: 'video', track: 'visual', assetId: 'source', start: 0, sourceStart: 24, duration: 96,
      audioEnvelope: {duration: 96, fadeIn: 24, fadeOut: 24, keyframes: [{frame: 0, value: 1}, {frame: 36, value: .3}, {frame: 60, value: .3}, {frame: 96, value: 1}]}})]};
}

it('combines frame-based fades and linear automation and validates editable points', () => {
  const envelope = audioEnvelopeSchema.parse({duration: 48, fadeIn: 12, fadeOut: 12, keyframes: [{frame: 0, value: 1}, {frame: 24, value: .5}]});
  expect(audioEnvelopeGain(envelope, 0)).toBe(0);
  expect(audioEnvelopeGain(envelope, 6)).toBe(.4375);
  expect(audioEnvelopeGain(envelope, 24)).toBe(.5);
  expect(audioEnvelopeGain(envelope, 42)).toBe(.25);
  expect(audioEnvelopeGain(envelope, 48)).toBe(0);
  expect(audioEnvelopeGain(null, 99)).toBe(1);
  expect(() => audioEnvelopeSchema.parse({duration: 24, keyframes: [{frame: 4, value: 1}, {frame: 4, value: .2}]})).toThrow('distinct');
  expect(() => audioEnvelopeSchema.parse({duration: 24, fadeIn: 25})).toThrow('fit inside');
});

it('retains the envelope through splits, ripple cuts, source head trims and export ranges', () => {
  const project = fixture(); const original = project.clips[0];
  const split = applyCommand(project, {type: 'clip.split', id: original.id, frame: 40, newId: 'right'});
  for(const clip of split.clips) for(let frame = 0; frame < clip.duration; frame++) expect(audioEnvelopeGain(clip.audioEnvelope, frame)).toBeCloseTo(audioEnvelopeGain(original.audioEnvelope, clip.start + frame));
  const cut = removeTimelineRanges(project, [{start: 20, end: 40}], () => 'remaining');
  expect(cut[1].audioEnvelope?.offset).toBe(40);
  expect(audioEnvelopeGain(cut[1].audioEnvelope, 12)).toBeCloseTo(audioEnvelopeGain(original.audioEnvelope, 52));
  const trimmed = applyCommand(project, {type: 'clip.update', id: original.id, patch: {sourceStart: 36, start: 12, duration: 84}}).clips[0];
  expect(trimmed.audioEnvelope?.offset).toBe(12);
  const untrimmed = applyCommand(project, {type: 'clip.update', id: original.id, patch: {sourceStart: 12, duration: 108}}).clips[0];
  expect(untrimmed.audioEnvelope?.offset).toBe(-12);
  expect(audioEnvelopeGain(untrimmed.audioEnvelope, 12)).toBe(audioEnvelopeGain(original.audioEnvelope, 0));
  const segment = layeredRenderPlan(project, exportSettingsSchema.parse({width: 128, height: 72, fps: 24, startSeconds: 1, endSeconds: 2}))!.segments[0];
  expect(segment.audioEnvelope?.offset).toBe(24);
  expect(audioEnvelopeGain(segment.audioEnvelope, 6)).toBeCloseTo(audioEnvelopeGain(original.audioEnvelope, 30));
});

it('preserves envelope time when converting frame rate and coalesces rounded keyframes', () => {
  const project = fixture(); const twice = reframeProject(project, 48);
  for(let frame = 0; frame < 96; frame++) expect(audioEnvelopeGain(twice.clips[0].audioEnvelope, frame * 2)).toBeCloseTo(audioEnvelopeGain(project.clips[0].audioEnvelope, frame));
  project.clips[0].audioEnvelope = audioEnvelopeSchema.parse({duration: 96, offset: 12, keyframes: [{frame: 0, value: 1}, {frame: 1, value: .8}, {frame: 2, value: .5}, {frame: 96, value: 1}]});
  const lowered = reframeProject(project, 6).clips[0].audioEnvelope!;
  expect(lowered.offset).toBe(3);
  expect(lowered.keyframes.slice(0, 2)).toEqual([{frame: 0, value: .8}, {frame: 1, value: .5}]);
  expect(audioEnvelopeSchema.safeParse(lowered).success).toBe(true);
});

it('generates editable ducking curves with overlapping attack/release and immediate edges', () => {
  const points = duckingKeyframes(120, [{start: 20, end: 40}, {start: 50, end: 80}], {gain: .2, attack: 10, release: 20});
  expect(keyframeGain(points, 0)).toBe(1);
  expect(keyframeGain(points, 15)).toBeCloseTo(.6);
  expect(keyframeGain(points, 30)).toBe(.2);
  expect(keyframeGain(points, 46)).toBeCloseTo(.44);
  expect(keyframeGain(points, 47)).toBeCloseTo(.44);
  expect(keyframeGain(points, 60)).toBe(.2);
  expect(keyframeGain(points, 100)).toBe(1);
  const instant = duckingKeyframes(60, [{start: 20, end: 40}], {gain: .1, attack: 0, release: 0});
  expect([19, 20, 39, 40].map(frame => keyframeGain(instant, frame))).toEqual([1, .1, .1, 1]);
});

it('applies the same per-frame gain in the native FFmpeg audio path', async () => {
  const envelope = audioEnvelopeSchema.parse({duration: 48, fadeIn: 12, fadeOut: 12, keyframes: [{frame: 0, value: 1}, {frame: 18, value: .25}, {frame: 30, value: .25}, {frame: 48, value: 1}]});
  const chunks: Buffer[] = [];
  await runProcess(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.5:s=24000:d=2', '-af', `asetnsamples=n=1000:p=0,${audioVolumeFilter(envelope, 24, .8)}`, '-ac', '1', '-f', 'f32le', '-'], 15000, {onOutput: chunk => chunks.push(chunk)});
  const pcm = Buffer.concat(chunks);
  expect(pcm.length).toBe(48000 * 4);
  for(let frame = 0; frame < 48; frame++) expect(pcm.readFloatLE(frame * 1000 * 4)).toBeCloseTo(.5 * .8 * audioEnvelopeGain(envelope, frame), 6);
}, 20000);
