import {expect, it} from 'vitest';
import {applyCommand, clipSchema, projectSchema} from '../shared/project';
import {relatedClipIds} from '../shared/editorial-tools';
import {copyTimelineClip} from '../shared/timeline-editing';
const project = () => projectSchema.parse({version: 1, id: 'p', name: 'Editor', revision: 0, width: 1280, height: 720, fps: 30,
  assets: [{id: 'v', kind: 'video', name: 'Video', src: '/media/v.mp4', duration: 30}, {id: 'a', kind: 'audio', name: 'Audio', src: '/media/a.wav', duration: 30}],
  clips: [clipSchema.parse({id: 'v1', name: 'Video 1', kind: 'video', track: 'visual', assetId: 'v', start: 0, duration: 90, sourceStart: 30, linkId: 'av'}),
    clipSchema.parse({id: 'a1', name: 'Audio 1', kind: 'audio', track: 'audio', assetId: 'a', start: 0, duration: 90, sourceStart: 30, linkId: 'av'}),
    clipSchema.parse({id: 'v2', name: 'Video 2', kind: 'video', track: 'visual', assetId: 'v', start: 90, duration: 60, sourceStart: 200})]});

it('moves transitive groups and links once and rejects moves before zero', () => {
  const p = applyCommand(project(), {type: 'clips.group', ids: ['a1', 'v2'], groupId: 'g'});
  expect(relatedClipIds(p, ['v1']).sort()).toEqual(['a1', 'v1', 'v2']);
  const moved = applyCommand(p, {type: 'clips.move', ids: ['v1', 'a1'], delta: 10});
  expect(moved.clips.map(c => c.start)).toEqual([10, 10, 100]);
  expect(p.clips[0].start).toBe(0);
  expect(() => applyCommand(p, {type: 'clips.move', ids: ['v1'], delta: -1})).toThrow();
});
it('splits linked video/audio together and links each new pair independently', () => {
  const result = applyCommand(project(), {type: 'clip.split', id: 'v1', frame: 45, newId: 'right'});
  expect(result.clips.filter(c => c.start === 0).map(c => c.duration)).toEqual([45, 45]);
  expect(relatedClipIds(result, ['right']).sort()).toEqual(['right', 'right:a1']);
  expect(result.clips.find(c => c.id === 'right:a1')).toMatchObject({sourceStart: 75, duration: 45});
});
it('trims and slips linked media without moving unrelated clips or exceeding the source', () => {
  const trimmed = applyCommand(project(), {type: 'clip.trim', id: 'v1', edge: 'start', delta: 12, linked: true, ripple: false});
  expect(trimmed.clips.slice(0, 2).map(c => [c.start, c.duration, c.sourceStart])).toEqual([[12, 78, 42], [12, 78, 42]]);
  const slipped = applyCommand(trimmed, {type: 'clip.slip', id: 'v1', delta: 20, linked: true});
  expect(slipped.clips.slice(0, 2).map(c => c.sourceStart)).toEqual([62, 62]);
  expect(slipped.clips[2]).toEqual(trimmed.clips[2]);
  expect(() => applyCommand(trimmed, {type: 'clip.slip', id: 'v1', delta: 900, linked: true})).toThrow();
});
it('rolls a cut with constant sequence duration and preserves linked boundaries', () => {
  const result = applyCommand(project(), {type: 'clip.roll', id: 'v1', delta: 15});
  expect(result.clips.slice(0, 2).map(c => c.duration)).toEqual([105, 105]);
  expect(result.clips[2]).toMatchObject({start: 105, duration: 45, sourceStart: 215});
});
it('ripple deletes the union of linked selections and closes only gaps empty on all tracks', () => {
  const result = applyCommand(project(), {type: 'timeline.ripple-delete', ids: ['v1', 'a1']});
  expect(result.clips).toHaveLength(1); expect(result.clips[0].start).toBe(0);
  expect(() => applyCommand(project(), {type: 'timeline.close-gap', frame: 20})).toThrow('empty');
  const gap = {...project(), clips: project().clips.map(c => ({...c, start: c.start + 30}))};
  expect(applyCommand(gap, {type: 'timeline.close-gap', frame: 0}).clips[0].start).toBe(0);
});
it('inserts source material across tracks and overwrites only the destination track', () => {
  const p = project(); const clip = clipSchema.parse({...p.clips[0], id: 'new', linkId: null, start: 30, duration: 15});
  const inserted = applyCommand(p, {type: 'timeline.place', clip, mode: 'insert'});
  expect(inserted.clips.find(c => c.id === 'v2')?.start).toBe(105);
  expect(inserted.clips.find(c => c.id === 'a1:insert:new')).toMatchObject({start: 45, sourceStart: 60, duration: 60});
  const overwritten = applyCommand(p, {type: 'timeline.place', clip, mode: 'overwrite'});
  expect(overwritten.clips.find(c => c.id === 'a1')).toEqual(p.clips[1]);
  expect(overwritten.clips.find(c => c.id === 'v1:overwrite:new')).toMatchObject({start: 45, duration: 45, sourceStart: 75});
});
it('a single clip copy cannot accidentally retain relationships to the originals', () => {
  const p = project(); expect(copyTimelineClip(p, p.clips[0], 'copy', 200, null)).toMatchObject({groupId: null, linkId: null});
});

it('detaches audio without transcoding or losing source handles and prevents accidental double sound', () => {
  const p = project();
  p.clips = [clipSchema.parse({...p.clips[0], linkId: null, volume: .6, audioEnvelope: {duration: 90, fadeIn: 12, fadeOut: 6}})];
  const command = {type: 'clip.detach-audio' as const, id: 'v1', newClipId: 'sound', newAssetId: 'sound-source', linkId: 'detached'};
  const result = applyCommand(p, command);
  expect(result.assets.find(a => a.id === 'sound-source')).toMatchObject({kind: 'audio', src: p.assets[0].src, duration: 30});
  expect(result.clips.find(c => c.id === 'sound')).toMatchObject({start: 0, sourceStart: 30, duration: 90, volume: .6, linkId: 'detached', audioEnvelope: {fadeIn: 12, fadeOut: 6}});
  expect(result.clips[0]).toMatchObject({volume: 0, linkId: 'detached'});
  expect(result.clips[0].audioEnvelope).toBeUndefined();
  expect(p.clips[0].volume).toBe(.6);
  expect(() => applyCommand(result, {...command, newClipId: 'second', newAssetId: 'second-source'})).toThrow('already has linked audio');
  expect(() => applyCommand({...p, assets: [{...p.assets[0], hasAudio: false}]}, command)).toThrow('containing audio');
});
