import {dimensionSchema, fpsSchema, type ExportSettings} from './media-settings';
import type {Asset, Project} from './project';

export const exportQualityPresets = [
  {id: 'high', label: 'High quality', description: 'Preserve gameplay detail', crf: 16},
  {id: 'balanced', label: 'Balanced', description: 'Quality and smaller files', crf: 20},
  {id: 'compact', label: 'Compact', description: 'Smaller sharing copies', crf: 24},
] as const;

/** Most-used footage first; imported but unused assets remain available explicitly. */
export function videoSources(project: Project): Asset[] {
  const duration = new Map<string, number>();
  for(const clip of project.clips) if(clip.kind === 'video' && clip.assetId) duration.set(clip.assetId, (duration.get(clip.assetId) ?? 0) + clip.duration);
  return project.assets.filter(asset => asset.kind === 'video' && asset.width && asset.height)
    .sort((a, b) => (duration.get(b.id) ?? 0) - (duration.get(a.id) ?? 0));
}

export function sourceOutputSettings(source: Asset, fallbackFps: number): {width: number; height: number; fps: number} | null {
  const width = Math.round((source.width ?? 0) / 2) * 2;
  const height = Math.round((source.height ?? 0) / 2) * 2;
  const fps = source.fps ?? fallbackFps;
  if(!dimensionSchema.safeParse(width).success || !dimensionSchema.safeParse(height).success || !fpsSchema.safeParse(fps).success) return null;
  return {width, height, fps};
}

export function outputQualityNotices(source: Asset | undefined, output: Pick<ExportSettings, 'width' | 'height' | 'fps'>): string[] {
  if(!source?.width || !source.height) return [];
  const notices: string[] = [];
  if(output.width < source.width && output.height < source.height) notices.push(`This output reduces ${source.width} × ${source.height} footage to ${output.width} × ${output.height}. Match the source to retain its resolution.`);
  else if(output.width > source.width && output.height > source.height) notices.push('This output is larger than the source. Upscaling does not create additional detail.');
  if(source.fps && output.fps < source.fps - .01) notices.push(`The source is ${Number(source.fps.toFixed(3))} fps. This frame rate drops frames from that footage.`);
  else if(source.fps && output.fps > source.fps + .01) notices.push('A higher output frame rate repeats source frames; it does not add motion detail.');
  return notices;
}
