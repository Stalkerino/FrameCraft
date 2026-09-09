import type {Clip} from './project';
/** Frame-based smoothstep, used by both the player and rendered compositions. */
export function zoomAtFrame(clip: Clip, frame: number): number {
  if(!clip.zoom) return 1;
  const zoom = clip.zoom;
  const t = Math.max(0, Math.min(1, (frame + (clip.motionOffset ?? 0) - zoom.start) / (zoom.end - zoom.start)));
  return zoom.from + (zoom.to - zoom.from) * t * t * (3 - 2 * t);
}
