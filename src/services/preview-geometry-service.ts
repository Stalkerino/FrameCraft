import type {Clip, Project} from '../../shared/project';
export interface Rect {left: number; top: number; width: number; height: number}
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type TransformPatch = Pick<Clip, 'x' | 'y' | 'scale'>;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function moveOnCanvas(clip: Clip, dx: number, dy: number, canvas: Rect): TransformPatch {
  return {x: clamp(clip.x + dx / canvas.width * 100, 0, 100), y: clamp(clip.y + dy / canvas.height * 100, 0, 100), scale: clip.scale};
}
/** Uniform resize about the opposite corner, translated back into domain percentages. */
export function resizeOnCanvas(clip: Clip, bounds: Rect, canvas: Rect, corner: Corner, dx: number, dy: number): TransformPatch {
  const sx = corner.endsWith('e') ? 1 : -1; const sy = corner.startsWith('s') ? 1 : -1;
  const factor = 1 + (dx * sx * bounds.width + dy * sy * bounds.height) / Math.max(1, bounds.width ** 2 + bounds.height ** 2);
  const scale = clamp(clip.scale * factor, .1, 4); const ratio = scale / clip.scale;
  const fixedX = bounds.left + (sx < 0 ? bounds.width : 0); const fixedY = bounds.top + (sy < 0 ? bounds.height : 0);
  let anchorX = clip.x / 100 * canvas.width; let anchorY = clip.y / 100 * canvas.height;
  if(clip.track === 'visual') {anchorX += ((clip.zoom?.x ?? 50) - 50) / 100 * canvas.width; anchorY += ((clip.zoom?.y ?? 50) - 50) / 100 * canvas.height;}
  // Text rises from its top edge. Use the measured edge to include entrance motion.
  else if(clip.kind === 'text' && !clip.caption) anchorY = bounds.top;
  return {...moveOnCanvas(clip, (anchorX - fixedX) * (ratio - 1), (anchorY - fixedY) * (ratio - 1), canvas), scale};
}
export function measurePreview(canvas: HTMLElement, project: Project, frame: number): {id: string; rect: Rect}[] {
  const root = canvas.getBoundingClientRect(); const result: {id: string; rect: Rect}[] = [];
  const active = new Map(project.clips.filter(c => c.track !== 'audio' && frame >= c.start && frame < c.start + c.duration).map(c => [c.id, c]));
  for(const element of canvas.querySelectorAll<HTMLElement>('[data-preview-clip]')) {
    const id = element.dataset.previewClip!; const clip = active.get(id); if(!clip) continue;
    const measured = element.getBoundingClientRect();
    const rect = {left: measured.left - root.left, top: measured.top - root.top, width: measured.width, height: measured.height};
    if(clip.track === 'visual') {
      const asset = project.assets.find(a => a.id === clip.assetId);
      if(asset?.width && asset.height) {
        const fit = Math.min(rect.width / asset.width, rect.height / asset.height);
        const width = asset.width * fit; const height = asset.height * fit;
        rect.left += (rect.width - width) / 2; rect.top += (rect.height - height) / 2; rect.width = width; rect.height = height;
      }
    }
    if(rect.width > 0 && rect.height > 0) result.push({id, rect});
  }
  return result;
}
