import {describe, expect, it} from 'vitest';
import {animationEditPatch, copyAnimationKeys, moveAnimationKeys, pasteAnimationKeys} from '../shared/animation-editing';
import {applyCommand, clipSchema} from '../shared/project';
import {createDemo} from '../shared/demo';
import {visualStateAtFrame} from '../shared/visual-editing';
import {gpuKeyframeFunction} from '../shared/gpu-animation';
import {fitAnimationCurve, zoomAnimationCurve, animationCurvePath} from '../src/services/animation-curve-service';

const makeClip = () => clipSchema.parse({id: 'title', kind: 'text', track: 'text', name: 'Title', start: 10, duration: 40, motionOffset: 20, animation: 'none',
  keyframes: {x: [{frame: 0, value: 10}, {frame: 30, value: 40}, {frame: 60, value: 90}], opacity: [{frame: 20, value: .5}]}});

describe('animation editing transactions', () => {
  it('moves groups without losing spacing, off-trim keys, easing or unrelated channels', () => {
    const clip = makeClip();
    const result = animationEditPatch(clip, {action: 'move', property: 'x', frames: [30, 60], deltaFrame: 3, deltaValue: 30});
    expect(result.keyframes?.x?.map(key => [key.frame, key.value])).toEqual([[0, 10], [33, 50], [63, 100]]);
    expect(result.keyframes?.opacity).toEqual(clip.keyframes?.opacity);
    expect(clip.keyframes?.x?.[1].frame).toBe(30);
    expect(moveAnimationKeys(clip.keyframes!.x!, [0, 30], -10, -50, 'x').keys.map(key => [key.frame, key.value])).toEqual([[0, 0], [30, 30], [60, 90]]);
  });
  it('rejects collisions, stale selections and invalid channel values atomically', () => {
    const clip = makeClip();
    expect(() => animationEditPatch(clip, {action: 'move', property: 'x', frames: [30], deltaFrame: 30, deltaValue: 0})).toThrow('occupies');
    expect(() => animationEditPatch(clip, {action: 'remove', property: 'x', frames: [123]})).toThrow('changed');
    expect(() => animationEditPatch(clip, {action: 'upsert', property: 'opacity', keys: [{frame: 5, value: 3, easing: 'linear'}]})).toThrow();
    expect(clip.keyframes?.x).toHaveLength(3);
  });
  it('clears a trimmed channel at the evaluated value and respects locks through the public reducer', () => {
    const clip = makeClip(); const project = {...createDemo(), clips: [clip], assets: []};
    const result = applyCommand(project, {type: 'clip.animate', id: clip.id, edit: {action: 'clear', property: 'x', localFrame: 10}});
    expect(result.clips[0].x).toBe(40); expect(result.clips[0].keyframes?.x).toBeUndefined();
    expect(result.clips[0].keyframes?.opacity).toEqual(clip.keyframes?.opacity);
    clip.positionLocked = true;
    expect(() => applyCommand(project, {type: 'clip.animate', id: clip.id, edit: {action: 'remove', property: 'x', frames: [30]}})).toThrow('locked');
  });
  it('pastes relative timing across frame rates and preserves custom handles without sharing references', () => {
    const clip = makeClip(); const keys = clip.keyframes!.x!;
    keys[1] = {...keys[1], easing: 'bezier', bezier: {x1: .2, y1: -.4, x2: .8, y2: 1.5}};
    const clipboard = copyAnimationKeys(keys, [30, 60], 'x', 30)!;
    const pasted = pasteAnimationKeys(clipboard, 20, 60, 'x');
    expect(pasted.map(key => key.frame)).toEqual([20, 80]); expect(pasted[0].bezier).toEqual(keys[1].bezier);
    pasted[0].bezier!.y1 = 2; expect(clipboard.keys[0].bezier!.y1).toBe(-.4);
    expect(() => pasteAnimationKeys(clipboard, 0, 30, 'opacity')).toThrow('same property');
    expect(() => pasteAnimationKeys(clipboard, -1, 30, 'x')).toThrow('clock');
    const tight = copyAnimationKeys([{frame: 0, value: 1, easing: 'linear'}, {frame: 1, value: 2, easing: 'linear'}], [0, 1], 'x', 120)!;
    expect(() => pasteAnimationKeys(tight, 0, 24, 'x')).toThrow('spacing');
  });
  it('updates easing through MCP command schema with the same persisted GPU/browser contract', () => {
    const clip = makeClip(); const bezier = {x1: .2, y1: -.4, x2: .8, y2: 1.5};
    const result = applyCommand({...createDemo(), clips: [clip], assets: []}, {type: 'clip.animate', id: clip.id, edit: {action: 'ease', property: 'x', frames: [0, 30], easing: 'bezier', bezier}}).clips[0];
    expect(result.keyframes!.x!.slice(0, 2).every(key => key.easing === 'bezier')).toBe(true);
    expect(gpuKeyframeFunction('x', result)).toContain('vec4(0.2,-0.4,0.8,1.5)');
    expect(visualStateAtFrame(result, 25).x).toBeGreaterThan(40);
    const split = applyCommand({...createDemo(), clips: [result], assets: []}, {type: 'clip.split', id: clip.id, frame: 25, newId: 'right'}).clips[1];
    expect(visualStateAtFrame(split, 10)).toEqual(visualStateAtFrame(result, 25));
  });
  it('fits off-trim keys on demand and preserves a bounded zoom around the playhead', () => {
    const clip = makeClip(); const fitted = fitAnimationCurve(clip, 'x'); const all = fitAnimationCurve(clip, 'x', true);
    expect(fitted).toMatchObject({start: 20, end: 59}); expect(all).toMatchObject({start: 0, end: 60});
    expect(zoomAnimationCurve(fitted, .5, 39.5)).toMatchObject({start: 29.75, end: 49.25});
    const path = animationCurvePath([{frame: 0, value: 0, easing: 'hold'}, {frame: 10, value: 100, easing: 'linear'}], 0, {start: 0, end: 10, low: 0, high: 100}, 'x');
    expect(path).toContain('L999.999'); expect(path.endsWith('L1000,0')).toBe(true);
  });
});
