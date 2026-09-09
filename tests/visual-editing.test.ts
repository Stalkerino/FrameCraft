import {describe, expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {applyCommand, clipSchema} from '../shared/project';
import {cropSchema, maskSchema, reframeVisualKeyframes, visualKeyframesSchema, visualStateAtFrame, visualTransformPatch, easeVisualProgress} from '../shared/visual-editing';
import {reframeProject} from '../shared/project-settings';
import {layeredRenderPlan} from '../shared/layered-render-plan';
import {exportSettingsSchema} from '../shared/media-settings';

describe('visual editing', () => {
  const makeClip = () => clipSchema.parse({id: 'video', name: 'Video', kind: 'video', track: 'visual', assetId: 'source', start: 0, duration: 90,
    keyframes: {x: [{frame: 0, value: 10, easing: 'linear'}, {frame: 60, value: 90}], opacity: [{frame: 0, value: 0, easing: 'hold'}, {frame: 20, value: 1}], rotation: [{frame: 0, value: 0}, {frame: 60, value: 720}]}});
  const makeProject = () => ({...createDemo(), width: 320, height: 180, fps: 30, clips: [makeClip()], assets: [{id: 'source', kind: 'video' as const, name: 'Video', src: '/source.mp4', duration: 10, width: 320, height: 180}]});
  it('evaluates linear, hold and custom Bézier interpolation with property bounds', () => {
    const clip = makeClip();
    expect(visualStateAtFrame(clip, 30)).toMatchObject({x: 50, rotation: 360, opacity: 1});
    expect(visualStateAtFrame(clip, 19).opacity).toBe(0); expect(visualStateAtFrame(clip, 20).opacity).toBe(1);
    expect(easeVisualProgress(.5, {easing: 'bezier', bezier: {x1: .25, y1: 0, x2: .75, y2: 1}})).toBeCloseTo(.5, 6);
    expect(easeVisualProgress(.25, {easing: 'ease-in'})).toBeLessThan(.25);
    clip.keyframes!.x![0] = {frame: 0, value: 10, easing: 'bezier', bezier: {x1: .2, y1: 8, x2: .8, y2: 8}};
    expect(visualStateAtFrame(clip, 30).x).toBe(100);
  });
  it('keeps animated samples unchanged through splits, range cuts, head trims and FPS changes', () => {
    const project = makeProject();
    const right = applyCommand(project, {type: 'clip.split', id: 'video', frame: 30, newId: 'right'}).clips.find(clip => clip.id === 'right')!;
    expect(visualStateAtFrame(right, 10)).toEqual(visualStateAtFrame(project.clips[0], 40));
    const assembled = applyCommand(project, {type: 'timeline.edit-ranges', operation: 'assemble', ranges: [{start: 30, end: 60}]}).clips[0];
    expect(visualStateAtFrame(assembled, 10)).toEqual(visualStateAtFrame(project.clips[0], 40));
    const trimmed = applyCommand(project, {type: 'clip.update', id: 'video', patch: {sourceStart: 30, duration: 60}}).clips[0];
    expect(visualStateAtFrame(trimmed, 10)).toEqual(visualStateAtFrame(project.clips[0], 40));
    const reframed = reframeProject(project, 60);
    expect(visualStateAtFrame(reframed.clips[0], 80)).toEqual(visualStateAtFrame(project.clips[0], 40));
  });
  it('writes evaluated canvas edits into existing curves and enforces position locks', () => {
    const project = makeProject(); const clip = project.clips[0];
    const patch = visualTransformPatch(clip, 30, {x: 65, scale: 2});
    expect(patch.x).toBeUndefined(); expect(patch.scale).toBe(2);
    expect(visualStateAtFrame({...clip, ...patch}, 30).x).toBe(65);
    clip.positionLocked = true;
    expect(visualTransformPatch(clip, 30, {x: 65})).toEqual({});
    expect(() => applyCommand(project, {type: 'clip.update', id: clip.id, patch})).toThrow('locked');
    expect(() => applyCommand(project, {type: 'project.settings', settings: {width: 320, height: 180, fps: 60, backgroundColor: '#080c0e', masterVolume: 1}})).not.toThrow();
    clip.keyframes!.x = [{frame: 0, value: 10, easing: 'linear'}, {frame: 1, value: 20, easing: 'linear'}];
    const compressed = {...clip, duration: 1, keyframes: reframeVisualKeyframes(clip.keyframes!, 1 / clip.duration)};
    expect(() => applyCommand(project, {type: 'clips.replace', clips: [compressed]})).not.toThrow();
  });
  it('rejects empty crops, incomplete polygons, duplicate keys and invalid easing', () => {
    expect(cropSchema.safeParse({left: 50, right: 50}).success).toBe(false);
    expect(maskSchema.safeParse({shape: 'polygon', points: [{x: 0, y: 0}, {x: 1, y: 1}]}).success).toBe(false);
    expect(visualKeyframesSchema.safeParse({x: [{frame: 0, value: 1}, {frame: 0, value: 2}]}).success).toBe(false);
    expect(visualKeyframesSchema.safeParse({x: [{frame: 0, value: 1, easing: 'bezier'}]}).success).toBe(false);
  });
  it('keeps native exports for plain clips and never caches moving titles as still images', () => {
    const project = makeProject(); project.clips[0].keyframes = null;
    const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, encoder: 'cpu'});
    expect(layeredRenderPlan(project, settings)).not.toBeNull();
    project.clips[0].crop = cropSchema.parse({left: 20}); expect(layeredRenderPlan(project, settings)).toBeNull();
    project.clips[0].crop = null;
    project.clips.push(clipSchema.parse({id: 'label', name: 'Label', kind: 'text', track: 'text', start: 0, duration: 90, animation: 'none', keyframes: {x: [{frame: 0, value: 10}, {frame: 89, value: 90}]}}));
    expect(layeredRenderPlan(project, settings)?.overlayFrames.length).toBe(90);
  });
});
