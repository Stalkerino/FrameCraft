import {z} from 'zod';
import type {Clip} from './project';

const percent = z.number().finite().min(0).max(100);
export const cropSchema = z.object({left: percent.default(0), top: percent.default(0), right: percent.default(0), bottom: percent.default(0)}).strict()
  .refine(crop => crop.left + crop.right < 100 && crop.top + crop.bottom < 100, 'Crop must retain a visible area');
export const maskSchema = z.object({
  shape: z.enum(['rectangle', 'ellipse', 'polygon']), x: percent.default(50), y: percent.default(50),
  width: percent.positive().default(100), height: percent.positive().default(100),
  points: z.array(z.object({x: percent, y: percent}).strict()).default([]),
  inverted: z.boolean().default(false), feather: z.number().finite().min(0).max(500).default(0),
}).strict().refine(mask => mask.shape !== 'polygon' || mask.points.length >= 3, 'A polygon mask needs at least three vertices');
export const easingNames = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'] as const;
export const bezierSchema = z.object({x1: z.number().min(0).max(1), y1: z.number().finite(), x2: z.number().min(0).max(1), y2: z.number().finite()}).strict();
export const visualKeyframeSchema = z.object({frame: z.number().int().nonnegative().safe(), value: z.number().finite(), easing: z.enum(easingNames).default('linear'), bezier: bezierSchema.optional()}).strict()
  .refine(key => key.easing !== 'bezier' || !!key.bezier, 'Custom easing needs Bézier control points');
export const visualProperties = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type VisualProperty = typeof visualProperties[number];
export const visualPropertyLimits: Record<VisualProperty, [number, number]> = {x: [0, 100], y: [0, 100], scale: [.1, 4], rotation: [-36000, 36000], opacity: [0, 1]};
const keysFor = (property: VisualProperty) => z.array(visualKeyframeSchema).refine(keys => keys.every((key, index) => (!index || key.frame > keys[index - 1].frame) && key.value >= visualPropertyLimits[property][0] && key.value <= visualPropertyLimits[property][1]), `Use ordered, unique frames and valid ${property} values`);
export const visualKeyframesSchema = z.object({x: keysFor('x').optional(), y: keysFor('y').optional(), scale: keysFor('scale').optional(), rotation: keysFor('rotation').optional(), opacity: keysFor('opacity').optional()}).strict();
export type Crop = z.infer<typeof cropSchema>;
export type Mask = z.infer<typeof maskSchema>;
export type VisualKeyframe = z.infer<typeof visualKeyframeSchema>;
export type VisualKeyframes = z.infer<typeof visualKeyframesSchema>;
export type VisualState = Record<VisualProperty, number>;

const cubic = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
export const visualBezierIterations = 32;
export function visualEasingCurve(key: Pick<VisualKeyframe, 'easing' | 'bezier'>) {
  return key.easing === 'bezier' ? key.bezier! : key.easing === 'ease-in' ? {x1: .42, y1: 0, x2: 1, y2: 1} : key.easing === 'ease-out' ? {x1: 0, y1: 0, x2: .58, y2: 1} : {x1: .42, y1: 0, x2: .58, y2: 1};
}
/** Invert monotonic Bézier time; y may overshoot, values clamp to the property range. */
export function easeVisualProgress(progress: number, key: Pick<VisualKeyframe, 'easing' | 'bezier'>): number {
  const t = Math.max(0, Math.min(1, progress));
  if(t === 0 || t === 1) return t;
  if(key.easing === 'hold') return 0;
  if(key.easing === 'linear') return t;
  const curve = visualEasingCurve(key);
  let low = 0; let high = 1;
  for(let iteration = 0; iteration < visualBezierIterations; iteration++) {const middle = (low + high) / 2; if(cubic(middle, curve.x1, curve.x2) < t) low = middle; else high = middle;}
  return cubic((low + high) / 2, curve.y1, curve.y2);
}

export function visualValueAtFrame(keys: VisualKeyframe[] | undefined, frame: number, fallback: number): number {
  if(!keys?.length) return fallback;
  if(frame <= keys[0].frame) return keys[0].value;
  let low = 0; let high = keys.length;
  while(low < high) {const middle = (low + high) >>> 1; if(keys[middle].frame <= frame) low = middle + 1; else high = middle;}
  const left = keys[low - 1]; const right = keys[low];
  return right ? left.value + (right.value - left.value) * easeVisualProgress((frame - left.frame) / (right.frame - left.frame), left) : left.value;
}

/** Keyframes retain the original animation clock across cuts and trims. */
export function visualStateAtFrame(clip: Clip, localFrame: number): VisualState {
  const frame = localFrame + (clip.motionOffset ?? 0);
  return Object.fromEntries(visualProperties.map(property => {
    const [min, max] = visualPropertyLimits[property];
    return [property, Math.max(min, Math.min(max, visualValueAtFrame(clip.keyframes?.[property], frame, clip[property] ?? (property === 'opacity' ? 1 : 0))))];
  })) as VisualState;
}

export function upsertVisualKeyframe(keys: VisualKeyframes | null | undefined, property: VisualProperty, key: VisualKeyframe): VisualKeyframes {
  return visualKeyframesSchema.parse({...keys, [property]: [...(keys?.[property] ?? []).filter(item => item.frame !== key.frame), key].sort((a, b) => a.frame - b.frame)});
}

export function visualTransformPatch(clip: Clip, localFrame: number, values: Partial<VisualState>): Partial<Clip> {
  const patch: Partial<Clip> = {}; let keys = clip.keyframes;
  for(const property of visualProperties) {
    const value = values[property]; if(value === undefined || clip.positionLocked && (property === 'x' || property === 'y')) continue;
    if(keys?.[property]?.length) {
      const frame = Math.max(0, Math.round(localFrame + (clip.motionOffset ?? 0)));
      const existing = keys[property]!.find(key => key.frame === frame);
      keys = upsertVisualKeyframe(keys, property, {...existing, frame, value, easing: existing?.easing ?? 'linear'}); patch.keyframes = keys;
    } else patch[property] = value;
  }
  return patch;
}

export function reframeVisualKeyframes(keys: VisualKeyframes, ratio: number): VisualKeyframes {
  return Object.fromEntries(visualProperties.filter(property => keys[property]).map(property => {
    const frames = new Map<number, VisualKeyframe>();
    for(const key of keys[property]!) {const frame = Math.round(key.frame * ratio); frames.set(frame, {...key, frame});}
    return [property, [...frames.values()]];
  }));
}
