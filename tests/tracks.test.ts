import {expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {applyCommand, clipSchema, validateProject} from '../shared/project';
import {clipTrackId, normalizeProjectTracks, projectTracks, trackSchema} from '../shared/tracks';
import {copyTimelineClip} from '../shared/timeline-editing';

it('keeps legacy tracks, validates destinations, orders layers and removes only empty tracks', () => {
  const original = createDemo(); const normalized = normalizeProjectTracks(original);
  expect(projectTracks(normalized).map(t => t.type)).toEqual(['text', 'visual', 'audio']); expect(clipTrackId(normalized, normalized.clips[0])).toBe('visual');
  let project = applyCommand(original, {type: 'track.add', track: trackSchema.parse({id: 'video-two', name: 'Video 2', type: 'visual'})});
  expect(projectTracks(project)[0].id).toBe('video-two');
  expect(() => applyCommand(project, {type: 'clip.move-track', id: 'title-1', trackId: 'video-two'})).toThrow('compatible');
  project = applyCommand(project, {type: 'clip.move-track', id: 'scene-1', trackId: 'video-two'});
  expect(project.clips[0].trackId).toBe('video-two'); expect(project.clips[0].start).toBe(original.clips[0].start);
  expect(() => applyCommand(project, {type: 'track.remove', id: 'video-two'})).toThrow('clips');
  project = applyCommand(project, {type: 'track.move', id: 'video-two', direction: 'down'}); expect(projectTracks(project)[1].id).toBe('video-two');
  project = applyCommand(project, {type: 'clip.move-track', id: 'scene-1', trackId: 'visual'});
  project = applyCommand(project, {type: 'track.remove', id: 'video-two'}); expect(projectTracks(project)).toHaveLength(3);
  expect(() => validateProject({...project, clips: [{...project.clips[0], trackId: 'missing'}]})).toThrow('matching');
});

it('locks coordinates across ordinary and batch edits while allowing content, scale and explicit unlock', () => {
  const project = applyCommand(createDemo(), {type: 'clip.update', id: 'title-1', patch: {positionLocked: true}});
  expect(() => applyCommand(project, {type: 'clip.update', id: 'title-1', patch: {x: 50}})).toThrow('locked');
  expect(() => applyCommand(project, {type: 'clips.replace', clips: project.clips.map(c => c.id === 'title-1' ? {...c, y: 10} : c)})).toThrow('locked');
  const edited = applyCommand(project, {type: 'clip.update', id: 'title-1', patch: {text: 'Still editable', scale: 1.5}});
  expect(edited.clips.find(c => c.id === 'title-1')?.x).toBe(9);
  expect(applyCommand(edited, {type: 'clip.update', id: 'title-1', patch: {positionLocked: false, x: 50}}).clips.find(c => c.id === 'title-1')?.x).toBe(50);
});

it('clears a single populated track with one command while retaining media and all other tracks', () => {
  const original = createDemo();
  const project = applyCommand(original, {type: 'track.add', track: trackSchema.parse({id: 'captions', name: 'Captions', type: 'text'})});
  project.clips.push(...Array.from({length: 150}, (_, i) => clipSchema.parse({id: `caption-${i}`, name: 'Caption', kind: 'text', track: 'text', trackId: 'captions', start: i * 30, duration: 30})));
  const cleared = applyCommand(project, {type: 'track.clear', id: 'captions'});
  expect(cleared.clips).toEqual(project.clips.filter(c => c.trackId !== 'captions'));
  expect(cleared.assets).toEqual(project.assets);
  expect(cleared.tracks).toEqual(project.tracks);
  expect(project.clips).toHaveLength(original.clips.length + 150);
  expect(() => applyCommand(project, {type: 'track.clear', id: 'missing'})).toThrow('Track no longer exists');
});

it('copies trimmed footage to a compatible track and preserves seconds when the project fps changes', () => {
  const project = applyCommand(createDemo(), {type: 'track.add', track: trackSchema.parse({id: 'video-two', name: 'Video 2', type: 'visual'})});
  project.fps = 60;
  project.assets.push({id: 'rush', name: 'Rush', kind: 'video', src: '/media/rush.mp4', duration: 30});
  const source = clipSchema.parse({id: 'original', name: 'Trimmed rush', kind: 'video', track: 'visual', assetId: 'rush', start: 90, duration: 60, sourceStart: 120, motionOffset: 15, positionLocked: true, x: 25, zoom: {from: 1, to: 2, x: 50, y: 50, start: 0, end: 30}});
  const copy = copyTimelineClip(project, source, 'pasted', 450, 'video-two', 30);
  expect(copy).toMatchObject({id: 'pasted', trackId: 'video-two', start: 450, sourceStart: 240, duration: 120, motionOffset: 30, positionLocked: true, x: 25, zoom: {end: 60}});
  copy.zoom!.to = 3; expect(source.zoom!.to).toBe(2);
  expect(() => copyTimelineClip(project, source, 'invalid', 0, 'text')).toThrow('compatible track');
});
