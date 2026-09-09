import {expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {applyCommand, clipSchema, durationOf, validateProject} from '../shared/project';
import {reframeProject} from '../shared/project-settings';
import {audioCodecsFor, canvasSettingsSchema, codecNames, exportSettingsSchema, extensionFor} from '../shared/media-settings';
it('changes project dimensions and fps in one operation while retaining source timing and neighboring boundaries', () => {
  const project = createDemo(); project.assets.push({id: 'v', name: 'v.mp4', kind: 'video', src: '/media/v.mp4', duration: 2});
  project.clips.push(clipSchema.parse({id: 'v', name: 'Video', kind: 'video', track: 'visual', assetId: 'v', start: 0, duration: 60, zoom: {from: 1, to: 2, x: 50, y: 50, start: 0, end: 30}}));
  const next = applyCommand(project, {type: 'project.settings', settings: canvasSettingsSchema.parse({width: 3840, height: 2160, fps: 60})});
  expect(durationOf(next) / next.fps).toBe(durationOf(project) / project.fps);
  expect(next.clips[0].start + next.clips[0].duration).toBe(next.clips[1].start);
  expect(next.clips.find(c => c.id === 'v')?.duration).toBe(120); expect(next.clips.find(c => c.id === 'v')?.zoom?.end).toBe(60);
  expect(next.clips.find(c => c.id === 'title-1')!.fontSize).toBe(project.clips.find(c => c.id === 'title-1')!.fontSize * 2);
  const fractional = reframeProject(next, 23.976); validateProject(fractional);
  expect(fractional.clips.find(c => c.id === 'v')!.duration).toBe(Math.floor(2 * 23.976));
  expect(Math.abs(durationOf(fractional) / fractional.fps - durationOf(project) / project.fps)).toBeLessThan(1 / fractional.fps);
});
it('resamples word timings and accepts only valid output combinations', () => {
  const project = createDemo(); project.clips[3].caption = {parentClipId: 'scene-1', style: 'highlight', highlightColor: '#ffffff', words: [{text: 'hello', start: 5, end: 10}]};
  const result = reframeProject(project, 60); expect(result.clips[3].caption?.words[0]).toEqual({text: 'hello', start: 10, end: 20});
  for(const codec of codecNames) expect(exportSettingsSchema.parse({width: 1080, height: 1920, fps: 59.94, codec, audioCodec: audioCodecsFor(codec)[0]}).codec).toBe(codec);
  expect(extensionFor('vp9')).toBe('webm'); expect(extensionFor('prores')).toBe('mov');
  expect(() => exportSettingsSchema.parse({width: 1919, height: 1080, fps: 30})).toThrow();
  expect(() => exportSettingsSchema.parse({width: 1920, height: 1080, fps: 30, codec: 'vp9', audioCodec: 'aac'})).toThrow('audio codec');
  expect(() => exportSettingsSchema.parse({width: 1920, height: 1080, fps: 30, crf: 0})).toThrow('CRF');
});
