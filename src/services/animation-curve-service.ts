import type {Clip} from '../../shared/project';
import {visualPropertyLimits, visualValueAtFrame, type VisualKeyframe, type VisualProperty} from '../../shared/visual-editing';

export interface CurveViewport {start: number; end: number; low: number; high: number}
export const animationPropertyNames: Record<VisualProperty, string> = {x: 'Position X', y: 'Position Y', scale: 'Scale', rotation: 'Rotation', opacity: 'Opacity'};
export const animationValue = (property: VisualProperty, value: number) => `${Number((value * (property === 'opacity' ? 100 : 1)).toFixed(2))}${property === 'rotation' ? '°' : property === 'scale' ? '×' : '%'}`;
export function fitAnimationCurve(clip: Clip, property: VisualProperty, all = false): CurveViewport {
  const offset = clip.motionOffset ?? 0; const keys = clip.keyframes?.[property] ?? [];
  const start = all ? Math.min(offset, ...keys.map(key => key.frame)) : offset;
  const end = Math.max(start + 1, all ? Math.max(offset + clip.duration - 1, ...keys.map(key => key.frame)) : offset + clip.duration - 1);
  const values = Array.from({length: 201}, (_, index) => visualValueAtFrame(keys, start + (end - start) * index / 200, clip[property] ?? 0));
  values.push(...keys.filter(key => key.frame >= start && key.frame <= end).map(key => key.value));
  const [min, max] = visualPropertyLimits[property]; const low = Math.max(min, Math.min(...values)); const high = Math.min(max, Math.max(...values));
  const pad = Math.max((high - low) * .2, property === 'opacity' || property === 'scale' ? .1 : 5);
  return {start, end, low: low - pad, high: high + pad};
}
export function zoomAnimationCurve(view: CurveViewport, factor: number, frame: number): CurveViewport {
  const anchor = Math.max(view.start, Math.min(view.end, frame));
  const width = Math.max(1, Math.min(10_000_000, (view.end - view.start) * factor));
  const start = anchor - (anchor - view.start) / (view.end - view.start) * width;
  return {...view, start, end: start + width};
}
/** Include exact key boundaries, so hold segments show a vertical step. */
export function animationCurvePath(keys: VisualKeyframe[], fallback: number, view: CurveViewport, property: VisualProperty) {
  const frames = new Set(Array.from({length: 241}, (_, i) => view.start + (view.end - view.start) * i / 240));
  for(const key of keys) if(key.frame > view.start && key.frame <= view.end) {frames.add(key.frame); frames.add(Math.max(view.start, key.frame - .00001));}
  const [min, max] = visualPropertyLimits[property];
  return [...frames].sort((a, b) => a - b).map((frame, index) => {
    const value = Math.max(min, Math.min(max, visualValueAtFrame(keys, frame, fallback)));
    return `${index ? 'L' : 'M'}${(frame - view.start) / (view.end - view.start) * 1000},${(view.high - value) / (view.high - view.low) * 300}`;
  }).join(' ');
}
