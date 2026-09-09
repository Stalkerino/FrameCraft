import type {Clip} from '../../shared/project';
import {visualStateAtFrame, visualTransformPatch, type VisualProperty} from '../../shared/visual-editing';
export {visualProperties, type VisualProperty} from '../../shared/visual-editing';
export type VisualValues = Pick<Clip, VisualProperty>;

/** Editing an animated property changes its key at this frame, not an unused base value. */
export const visualPropertyPatch = visualTransformPatch;

export function evaluatedVisualClip(clip: Clip, localFrame: number): Clip {
  return {...clip, ...visualStateAtFrame(clip, localFrame)};
}
