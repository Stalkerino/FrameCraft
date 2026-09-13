import {z} from 'zod';
import type {Clip} from './project';
import {bezierSchema, easingNames, visualKeyframeSchema, visualKeyframesSchema, visualProperties, visualPropertyLimits, visualStateAtFrame, type VisualKeyframe, type VisualProperty} from './visual-editing';

const property = z.enum(visualProperties);
const frames = z.array(z.number().int().nonnegative().safe()).min(1);
export const animationEditSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('upsert'), property, keys: z.array(visualKeyframeSchema).min(1)}).strict(),
  z.object({action: z.literal('move'), property, frames, deltaFrame: z.number().int().safe(), deltaValue: z.number().finite().default(0)}).strict(),
  z.object({action: z.literal('remove'), property, frames}).strict(),
  z.object({action: z.literal('ease'), property, frames, easing: z.enum(easingNames), bezier: bezierSchema.optional()}).strict(),
  z.object({action: z.literal('clear'), property, localFrame: z.number().int().nonnegative().safe()}).strict(),
]);
export type AnimationEdit = z.infer<typeof animationEditSchema>;
export const animationCommandSchema = z.object({type: z.literal('clip.animate'), id: z.string().min(1), edit: animationEditSchema});

/** Move a selection as a group. Collisions fail atomically, never erase another key. */
export function moveAnimationKeys(keys: VisualKeyframe[], selected: number[], deltaFrame: number, deltaValue: number, property: VisualProperty) {
  const chosen = new Set(selected); const group = keys.filter(key => chosen.has(key.frame));
  if(group.length !== chosen.size) throw new Error('The selected animation keys have changed. Select them again.');
  const [min, max] = visualPropertyLimits[property];
  const time = Math.max(deltaFrame, -Math.min(...group.map(key => key.frame)));
  const value = Math.max(min - Math.min(...group.map(key => key.value)), Math.min(max - Math.max(...group.map(key => key.value)), deltaValue));
  const next = keys.map(key => chosen.has(key.frame) ? {...key, frame: key.frame + time, value: key.value + value} : key).sort((a, b) => a.frame - b.frame);
  if(next.some((key, index) => index > 0 && next[index - 1].frame === key.frame)) throw new Error('Another key occupies that frame. Move the selection to a free frame.');
  return {keys: next, frames: group.map(key => key.frame + time)};
}

/** Shared by UI and MCP; retain off-trim keys and all unrelated channels. */
export function animationEditPatch(clip: Clip, input: AnimationEdit): Partial<Clip> {
  const edit = animationEditSchema.parse(input);
  if(clip.track === 'audio') throw new Error('Choose a visual clip for transform animation.');
  if(clip.positionLocked && (edit.property === 'x' || edit.property === 'y')) throw new Error('This clip’s position is locked.');
  const keys = clip.keyframes?.[edit.property] ?? []; let next = keys;
  if('frames' in edit && edit.frames.some(frame => !keys.some(key => key.frame === frame))) throw new Error('The selected animation keys have changed. Select them again.');
  switch(edit.action) {
    case 'upsert': {
      visualKeyframesSchema.parse({[edit.property]: edit.keys});
      const byFrame = new Map(keys.map(key => [key.frame, key]));
      for(const key of edit.keys) byFrame.set(key.frame, key);
      next = [...byFrame.values()].sort((a, b) => a.frame - b.frame); break;
    }
    case 'move': next = moveAnimationKeys(keys, edit.frames, edit.deltaFrame, edit.deltaValue, edit.property).keys; break;
    case 'remove': next = keys.filter(key => !edit.frames.includes(key.frame)); break;
    case 'ease': next = keys.map(key => edit.frames.includes(key.frame) ? {...key, easing: edit.easing, bezier: edit.easing === 'bezier' ? edit.bezier ?? key.bezier ?? {x1: .25, y1: .1, x2: .25, y2: 1} : undefined} : key); break;
    case 'clear': next = []; break;
  }
  const keyframes = {...clip.keyframes};
  if(next.length) keyframes[edit.property] = next; else delete keyframes[edit.property];
  return {keyframes: Object.keys(keyframes).length ? visualKeyframesSchema.parse(keyframes) : null,
    ...(edit.action === 'clear' ? {[edit.property]: visualStateAtFrame(clip, edit.localFrame)[edit.property]} : {})};
}

export interface AnimationClipboard {property: VisualProperty; fps: number; keys: VisualKeyframe[]}
export function copyAnimationKeys(keys: VisualKeyframe[], selected: number[], property: VisualProperty, fps: number): AnimationClipboard | null {
  const chosen = keys.filter(key => selected.includes(key.frame));
  return chosen.length ? {property, fps, keys: structuredClone(chosen.map(key => ({...key, frame: key.frame - chosen[0].frame})))} : null;
}
export function pasteAnimationKeys(clipboard: AnimationClipboard, frame: number, fps: number, property: VisualProperty): VisualKeyframe[] {
  if(clipboard.property !== property) throw new Error('Paste keys into the same property to preserve their units.');
  if(frame < 0) throw new Error('Move the playhead inside the original animation clock before pasting.');
  const keys = clipboard.keys.map(key => ({...structuredClone(key), frame: frame + Math.round(key.frame * fps / clipboard.fps)}));
  if(new Set(keys.map(key => key.frame)).size !== keys.length) throw new Error('These keys are closer than one frame at the destination frame rate. Increase their spacing before copying.');
  return visualKeyframesSchema.parse({[property]: keys})[property]!;
}
