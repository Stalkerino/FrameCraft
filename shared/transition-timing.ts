import type {Clip} from './project';

export const transitionGeometry = {diagonalReach: 1.35, diagonalSlope: .35, pixelRows: 10, pixelReach: 13, pixelPhase: 7, pixelPeriod: 4};
export const transitionDenominator = (clip: Pick<Clip, 'duration' | 'transitionFrames'>) => Math.max(1, Math.min(clip.transitionFrames, clip.duration) - 1);
export const transitionProgress = (clip: Pick<Clip, 'duration' | 'transitionFrames'>, frame: number) => Math.min(1, frame / transitionDenominator(clip));
export function transitionHold(clip: Clip, next?: Clip) {
  return next && next.start === clip.start + clip.duration && (next.transition !== 'none' || next.presetTransition) ? Math.min(next.transitionFrames, next.duration) : 0;
}
