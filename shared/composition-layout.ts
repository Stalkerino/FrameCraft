import type {ExportSettings} from './media-settings';
import type {Asset, Clip, Project} from './project';
import {videoPlacement, type VideoPlacement} from './video-placement';

/** Canvas transform shared by browser preview and native scene compilation. */
export function compositionOutputTransform(project: Pick<Project, 'width' | 'height'>, output: Pick<ExportSettings, 'width' | 'height' | 'fit'>) {
  const sx = output.width / project.width; const sy = output.height / project.height;
  const scale = output.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const scaleX = output.fit === 'stretch' ? sx : scale; const scaleY = output.fit === 'stretch' ? sy : scale;
  return {scaleX, scaleY, x: (output.width - project.width * scaleX) / 2, y: (output.height - project.height * scaleY) / 2};
}

/** Clip to the project canvas first, apply the output transform, then clip to
 * the export canvas. Cropping hides pixels instead of stretching the remainder.
 */
export function outputVideoPlacement(clip: Clip, asset: Asset, project: Project, output: Pick<ExportSettings, 'width' | 'height' | 'fit'>): VideoPlacement | null {
  const p = videoPlacement(clip, asset, project, project);
  if(!p) return null;
  const transform = compositionOutputTransform(project, output);
  const dx = transform.x + p.destination.x * transform.scaleX; const dy = transform.y + p.destination.y * transform.scaleY;
  const dw = p.destination.width * transform.scaleX; const dh = p.destination.height * transform.scaleY;
  const x = Math.max(0, dx); const y = Math.max(0, dy);
  const right = Math.min(output.width, dx + dw); const bottom = Math.min(output.height, dy + dh);
  if(right <= x || bottom <= y) return null;
  return {source: {x: p.source.x + (x - dx) / dw * p.source.width, y: p.source.y + (y - dy) / dh * p.source.height,
    width: (right - x) / dw * p.source.width, height: (bottom - y) / dh * p.source.height},
    destination: {x, y, width: right - x, height: bottom - y}};
}
