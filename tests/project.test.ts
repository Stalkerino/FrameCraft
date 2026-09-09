import {describe, expect, it} from 'vitest';
import {applyCommand, clipSchema, durationOf, validateProject} from '../shared/project';
import {createDemo} from '../shared/demo';

describe('timeline domain invariants', () => {
  it('splits footage at an absolute timeline frame and preserves the source interval', () => {
    const project = createDemo();
    project.assets.push({id: 'video', name: 'capture.mp4', kind: 'video', src: '/media/test.mp4', duration: 10});
    project.clips = [clipSchema.parse({id: 'clip', name: 'Capture', assetId: 'video', kind: 'video', track: 'visual', start: 90, duration: 150, sourceStart: 30})];
    const next = applyCommand(project, {type: 'clip.split', id: 'clip', frame: 150, newId: 'right'});
    expect(next.clips.map(c => [c.start, c.duration, c.sourceStart])).toEqual([[90, 60, 30], [150, 90, 90]]);
    expect(durationOf(next)).toBe(240); expect(project.clips).toHaveLength(1);
  });
  it('rejects split endpoints, duplicate IDs, missing media and source overruns', () => {
    const project = createDemo();
    expect(() => applyCommand(project, {type: 'clip.split', id: 'scene-1', frame: 0, newId: 'other'})).toThrow('inside');
    expect(() => applyCommand(project, {type: 'clip.split', id: 'scene-1', frame: 180, newId: 'other'})).toThrow('inside');
    expect(() => applyCommand(project, {type: 'clip.add', clip: project.clips[0]})).toThrow('Duplicate');
    expect(() => applyCommand(project, {type: 'clip.add', clip: {...project.clips[0], id: 'missing', assetId: 'nope'}})).toThrow('matching');
    project.assets.push({id: 'audio', name: 'audio', kind: 'audio', src: '/media/audio.wav', duration: 1});
    expect(() => applyCommand(project, {type: 'clip.add', clip: clipSchema.parse({id: 'audio-clip', name: 'Audio', kind: 'audio', track: 'audio', assetId: 'audio', start: 0, duration: 31})})).toThrow('source duration');
  });
  it('changes only explicitly supplied properties and rejects invalid tracks and negative timing', () => {
    const project = createDemo(); const original = project.clips[3];
    const next = applyCommand(project, {type: 'clip.update', id: original.id, patch: {text: 'Edited'}});
    expect(next.clips[3]).toEqual({...original, text: 'Edited'});
    expect(() => applyCommand(project, {type: 'clip.update', id: original.id, patch: {start: -1}})).toThrow();
    project.clips[0].track = 'audio'; expect(() => validateProject(project)).toThrow('track');
  });
});
