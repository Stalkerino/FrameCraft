import {describe, expect, it} from 'vitest';
import {clipSchema, projectSchema, validateProject, type Project} from '../shared/project';
import {presetStarters} from '../shared/preset-starters';
import {editTimelineRanges} from '../shared/timeline-ranges';

function fixture(): Project {
  const graphic = presetStarters.find(preset => preset.id === 'progress-line')!;
  const transition = presetStarters.find(preset => preset.id === 'clean-fade')!;
  const clip = (value: object) => clipSchema.parse({name: 'Clip', start: 0, duration: 180, ...value});
  return validateProject(projectSchema.parse({version: 1, id: 'range-test', name: 'Range editing', revision: 0, width: 1280, height: 720, fps: 30,
    assets: [{id: 'footage', name: 'Footage', kind: 'video', src: '/footage.mp4', duration: 20}, {id: 'music', name: 'Music', kind: 'audio', src: '/music.wav', duration: 20}],
    clips: [
      clip({id: 'video', kind: 'video', track: 'visual', assetId: 'footage', sourceStart: 10, motionOffset: 5, volume: .8, positionLocked: true, x: 60, transition: 'none', presetTransition: {presetId: transition.id, version: 1, definition: transition.definition, values: {}, duration: .6}}),
      clip({id: 'audio', kind: 'audio', track: 'audio', assetId: 'music', sourceStart: 100, volume: .3, audioEnvelope: {duration: 180, offset: 2, fadeIn: 12, fadeOut: 18, keyframes: [{frame: 30, value: .4}]}}),
      clip({id: 'artwork', kind: 'graphic', track: 'text', motionOffset: 3, graphic: {presetId: graphic.id, version: 1, definition: graphic.definition, values: {}, duration: 10}}),
      clip({id: 'caption', kind: 'text', track: 'text', animation: 'none', caption: {parentClipId: 'video', style: 'highlight', highlightColor: '#ffffff', words: [{text: 'Before', start: 0, end: 60}, {text: 'Cut', start: 60, end: 90}, {text: 'After', start: 90, end: 180}]}}),
    ],
  }));
}

describe('coordinated timeline range edits', () => {
  it('merges removals and ripples video, audio, graphics and linked captions together', () => {
    const project = fixture(); const before = structuredClone(project);
    const result = editTimelineRanges(project, {operation: 'remove', ranges: [{start: 70, end: 90}, {start: 60, end: 80}]});
    expect(result.ranges).toEqual([{start: 60, end: 90}]);
    expect(result.beforeDuration).toBe(180); expect(result.afterDuration).toBe(150);
    expect(result.affectedClipCount).toBe(4); expect(result.warnings).toEqual([]);
    for(const original of project.clips) {
      const first = result.clips.find(clip => clip.id === original.id)!;
      const second = result.clips.find(clip => clip.id === `${original.id}-range-2`)!;
      expect([first.start, first.duration, second.start, second.duration]).toEqual([0, 60, 60, 90]);
      expect(second.motionOffset).toBe((original.motionOffset ?? 0) + 90);
      expect(second.sourceStart).toBe(original.sourceStart + (original.kind === 'graphic' ? 0 : 90));
      expect(second.volume).toBe(original.volume);
      expect(second.transition).toBe('none'); expect(second.presetTransition).toBeNull();
    }
    expect(result.clips.find(clip => clip.id === 'caption-range-2')!.caption!.parentClipId).toBe('video-range-2');
    expect(result.clips.find(clip => clip.id === 'audio-range-2')!.audioEnvelope).toEqual({...project.clips.find(clip => clip.id === 'audio')!.audioEnvelope, offset: 92});
    expect(result.clips.find(clip => clip.id === 'artwork-range-2')!.graphic).toEqual(project.clips.find(clip => clip.id === 'artwork')!.graphic);
    expect(result.clips.find(clip => clip.id === 'video')!.presetTransition).toEqual(project.clips[0].presetTransition);
    expect(validateProject({...project, clips: result.clips}).assets).toEqual(project.assets);
    expect(project).toEqual(before);
  });

  it('assembles reordered and repeated original intervals with deterministic IDs and matching caption parents', () => {
    const project = fixture();
    project.clips.push(clipSchema.parse({id: 'video-range-2', name: 'Unselected interval', kind: 'text', track: 'text', start: 200, duration: 30}));
    const request = {operation: 'assemble' as const, ranges: [{start: 120, end: 180}, {start: 30, end: 90}, {start: 120, end: 180}]};
    const result = editTimelineRanges(project, request);
    const video = result.clips.filter(clip => clip.kind === 'video');
    expect(video.map(clip => [clip.id, clip.start, clip.duration, clip.sourceStart])).toEqual([
      ['video', 0, 60, 130], ['video-range-3', 60, 60, 40], ['video-range-4', 120, 60, 130],
    ]);
    expect(result.clips.filter(clip => clip.caption).map(clip => clip.caption!.parentClipId)).toEqual(video.map(clip => clip.id));
    expect(result.clips.filter(clip => clip.kind === 'audio').map(clip => clip.sourceStart)).toEqual([220, 130, 220]);
    expect(new Set(result.clips.map(clip => clip.id)).size).toBe(result.clips.length);
    expect(editTimelineRanges(project, request)).toEqual(result);
    expect(validateProject({...project, clips: result.clips}).clips.length).toBe(12);
    expect(result.afterDuration).toBe(180); expect(result.warnings).toEqual([]);
  });

  it('leaves unselected tracks untouched and preserves gaps when assembling sparse clips', () => {
    const project = fixture();
    project.clips[0] = {...project.clips[0], start: 30, duration: 120};
    const result = editTimelineRanges(project, {operation: 'assemble', ranges: [{start: 0, end: 60}, {start: 90, end: 180}], trackIds: ['visual']});
    expect(result.clips.filter(clip => clip.track !== 'visual')).toEqual(project.clips.filter(clip => clip.track !== 'visual'));
    expect(result.clips.filter(clip => clip.track === 'visual').map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[30, 30, 10], [60, 60, 70]]);
    expect(result.trackIds).toEqual(['visual']); expect(result.affectedClipCount).toBe(1);
    expect(result.afterDuration).toBe(180); // Untouched music/overlays retain their end.
    expect(result.warnings[0]).toContain('caption/source');
    const removed = editTimelineRanges(project, {operation: 'remove', ranges: [{start: 60, end: 90}], trackIds: ['audio']});
    expect(removed.clips.filter(clip => clip.track !== 'audio')).toEqual(project.clips.filter(clip => clip.track !== 'audio'));
    expect(removed.clips.filter(clip => clip.track === 'audio').map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[0, 60, 100], [60, 90, 190]]);
  });

  it('validates boundaries and selections, supports removing the complete sequence, and has no range count cap', () => {
    const project = fixture();
    for(const ranges of [[], [{start: -1, end: 30}], [{start: 0, end: 181}], [{start: 30, end: 30}], [{start: .5, end: 30}]]) {
      expect(() => editTimelineRanges(project, {operation: 'remove', ranges})).toThrow();
    }
    for(const trackIds of [[], ['missing'], ['visual', 'visual']]) {
      expect(() => editTimelineRanges(project, {operation: 'remove', ranges: [{start: 0, end: 30}], trackIds})).toThrow();
    }
    const empty = editTimelineRanges(project, {operation: 'remove', ranges: [{start: 0, end: 180}]});
    expect(empty.clips).toEqual([]); expect(empty.afterDuration).toBe(30); expect(empty.affectedClipCount).toBe(4);
    const repeated = editTimelineRanges(project, {operation: 'assemble', ranges: Array.from({length: 101}, () => ({start: 0, end: 1}))});
    expect(repeated.clips).toHaveLength(404); expect(repeated.afterDuration).toBe(101);
  });
});
