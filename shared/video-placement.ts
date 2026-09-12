import type {Asset, Clip, Project} from './project';

export interface VideoPlacement {
  source: {x: number; y: number; width: number; height: number};
  destination: {x: number; y: number; width: number; height: number};
}

/** Same order as VisualLayer: contain in the project canvas, clip its inset,
 * scale around the canvas centre, translate, then clip to the output canvas.
 * Cropping hides pixels; it must not stretch the retained region to fill the frame.
 */
export function videoPlacement(clip: Clip, asset: Asset, project: Pick<Project, 'width' | 'height'>, output: Pick<Project, 'width' | 'height'>): VideoPlacement | null {
  const sw = asset.width!; const sh = asset.height!;
  const contain = Math.min(project.width / sw, project.height / sh);
  const left = (project.width - sw * contain) / 2; const top = (project.height - sh * contain) / 2;
  const crop = clip.crop ?? {left: 0, top: 0, right: 0, bottom: 0};
  const scaleX = clip.scale * output.width / project.width;
  const scaleY = clip.scale * output.height / project.height;
  const tx = output.width * (clip.x / 100 - clip.scale / 2);
  const ty = output.height * (clip.y / 100 - clip.scale / 2);
  const x0 = Math.max(left, project.width * crop.left / 100, -tx / scaleX);
  const y0 = Math.max(top, project.height * crop.top / 100, -ty / scaleY);
  const x1 = Math.min(left + sw * contain, project.width * (1 - crop.right / 100), (output.width - tx) / scaleX);
  const y1 = Math.min(top + sh * contain, project.height * (1 - crop.bottom / 100), (output.height - ty) / scaleY);
  if(x1 <= x0 || y1 <= y0) return null;
  return {source: {x: (x0 - left) / contain, y: (y0 - top) / contain, width: (x1 - x0) / contain, height: (y1 - y0) / contain},
    destination: {x: tx + x0 * scaleX, y: ty + y0 * scaleY, width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY}};
}
