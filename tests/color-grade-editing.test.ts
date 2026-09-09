import {describe, expect, it} from 'vitest';
import {applyCommand, clipSchema, type Project} from '../shared/project';
import {colorGradeCommands, type ColorGradeRequest} from '../shared/color-grade-editing';
import {neutralColorGrade} from '../shared/color-grading';

const project = (): Project => ({version: 1, id: 'grading', name: 'Color test', revision: 0, width: 640, height: 360, fps: 30,
  assets: [{id: 'footage', kind: 'video', name: 'Source', src: '/media/source.mp4', duration: 10}],
  clips: [clipSchema.parse({id: 'video', kind: 'video', name: 'Footage', assetId: 'footage', track: 'visual', start: 0, duration: 120, sourceStart: 30, opacity: .75, colorGrade: {saturation: .8}, audioEnvelope: {duration: 120, fadeIn: 20}}),
    clipSchema.parse({id: 'caption', kind: 'text', name: 'Caption', track: 'text', start: 15, duration: 90, sourceStart: 45, caption: {parentClipId: 'video', style: 'clean', highlightColor: '#ffff00', words: [{text: 'Hello', start: 40, end: 200}]}})]});
const request = (patch: Partial<ColorGradeRequest>): ColorGradeRequest => ({revision: 0, scope: 'clips', clipIds: ['video'], grade: {exposure: 1}, apply: true, ...patch});
const edit = (p: Project, input: ColorGradeRequest) => colorGradeCommands(p, input).commands.reduce(applyCommand, p);

describe('scoped color grading', () => {
  it('merges selected settings, distinguishes global and clip reset, and leaves opacity alone', () => {
    const original = project();
    const local = edit(original, request({}));
    expect(local.clips[0]).toMatchObject({colorGrade: {...neutralColorGrade, saturation: .8, exposure: 1}, opacity: .75});
    const global = edit(local, request({scope: 'timeline', clipIds: undefined, grade: {temperature: .4}}));
    expect(global.colorGrade?.temperature).toBe(.4); expect(global.clips).toEqual(local.clips);
    const reset = edit(global, request({grade: null}));
    expect(reset.clips[0].colorGrade).toBeNull(); expect(reset.colorGrade?.temperature).toBe(.4);
  });
  it('grades only the requested span, preserving media time, captions, automation and surrounding grades', () => {
    const original = project(); const changed = edit(original, request({ranges: [{start: 30, end: 60}]}));
    const video = changed.clips.filter(clip => clip.kind === 'video');
    expect(video.map(clip => [clip.start, clip.duration, clip.sourceStart, clip.colorGrade?.exposure])).toEqual([[0, 30, 30, 0], [30, 30, 60, 1], [60, 60, 90, 0]]);
    expect(video.map(clip => clip.audioEnvelope?.offset)).toEqual([0, 30, 60]);
    const captions = changed.clips.filter(clip => clip.caption);
    expect(captions.map(clip => [clip.start, clip.duration, clip.sourceStart])).toEqual([[15, 15, 45], [30, 30, 60], [60, 45, 90]]);
    expect(captions.map(clip => clip.caption?.parentClipId)).toEqual(video.map(clip => clip.id));
    expect(changed.assets).toEqual(original.assets);
    expect(new Set(changed.clips.map(clip => clip.id)).size).toBe(changed.clips.length);
    original.clips[1].duration = 150;
    const extended = edit(original, request({ranges: [{start: 30, end: 60}]})).clips.filter(clip => clip.caption);
    expect(extended.reduce((sum, clip) => sum + clip.duration, 0)).toBe(150);
    expect(extended.at(-1)!.start + extended.at(-1)!.duration).toBe(165);
  });
  it('rejects ambiguous scopes and range boundaries that would retime an entrance', () => {
    const p = project(); p.clips[0].transition = 'fade'; p.clips[0].transitionFrames = 18;
    expect(() => edit(p, request({ranges: [{start: 5, end: 50}]}))).toThrow('entrance transition');
    expect(() => edit(p, request({ranges: [{start: 30, end: 70}]}))).not.toThrow();
    expect(() => edit(p, request({scope: 'timeline'}))).toThrow('clipIds');
    expect(() => edit(p, request({clipIds: ['caption']}))).toThrow('video or image');
  });
});
