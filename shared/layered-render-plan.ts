import type {Asset, Clip, Project} from './project';
import {durationOf} from './project';
import type {ExportSettings} from './media-settings';
import {clipTrackId, projectTracks, trackClips} from './tracks';
import {resolvePresetValues, scalarAt} from './asset-presets';
import {zoomAtFrame} from './clip-animation';
import {shiftAudioEnvelope, type AudioEnvelope} from './audio-envelope';
import type {ColorGrade} from './color-grading';
import {visualProperties} from './visual-editing';

export interface VideoSegment {start: number; duration: number; sourceStart: number; volume: number; audioEnvelope?: AudioEnvelope | null; colorGrade?: ColorGrade | null; projectColorGrade?: ColorGrade | null; opacity?: number; backgroundColor?: string; asset: Asset}
export interface OverlayRun {frame: number; duration: number}
export interface LayeredRenderPlan {baseTrackId: string; firstFrame: number; lastFrame: number; segments: VideoSegment[]; overlayFrames: number[]; overlayRuns: OverlayRun[]}
export interface OverlayRenderPass {omitTrackId: string}

export function exportFrameRange(project: Project, settings: ExportSettings): [number, number] {
  const last = durationOf(project) - 1;
  return [Math.min(last, Math.floor(settings.startSeconds * settings.fps)), Math.min(last, Math.ceil((settings.endSeconds ?? durationOf(project) / project.fps) * settings.fps) - 1)];
}

/** The base must be a full-canvas sequence of cuts. All artwork still uses React. */
export function layeredRenderPlan(project: Project, settings: ExportSettings): LayeredRenderPlan | null {
  if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec)) return null;
  if(Math.abs(project.width / project.height - settings.width / settings.height) > 1e-6) return null;
  const tracks = [...projectTracks(project)].filter(track => !track.hidden).reverse();
  const base = tracks.find(track => track.type === 'visual');
  if(!base) return null;
  const [firstFrame, lastFrame] = exportFrameRange(project, settings);
  const intersects = (clip: Clip) => clip.start <= lastFrame && clip.start + clip.duration > firstFrame;
  const segments: VideoSegment[] = [];
  let cursor = firstFrame;
  for(const clip of trackClips(project, base.id).filter(intersects)) {
    const asset = project.assets.find(asset => asset.id === clip.assetId);
    if(clip.kind !== 'video' || !asset || !asset.width || !asset.height || clip.x !== 50 || clip.y !== 50 || clip.scale !== 1 || clip.zoom || clip.transition !== 'none' || clip.presetTransition || clip.rotation || clip.crop || clip.mask || visualProperties.some(property => clip.keyframes?.[property]?.length)) return null;
    if(Math.abs(asset.width / asset.height - project.width / project.height) > 1e-6) return null;
    const start = Math.max(firstFrame, clip.start); const end = Math.min(lastFrame + 1, clip.start + clip.duration);
    if(start !== cursor) return null;
    segments.push({start, duration: end - start, sourceStart: clip.sourceStart + start - clip.start,
      volume: base.muted ? 0 : clip.volume * (project.masterVolume ?? 1), ...(clip.audioEnvelope ? {audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, start - clip.start)} : {}), colorGrade: clip.colorGrade, projectColorGrade: project.colorGrade, opacity: clip.opacity, backgroundColor: project.backgroundColor, asset});
    cursor = end;
  }
  if(cursor !== lastFrame + 1) return null;
  const visibleIds = new Set(tracks.filter(track => track.id !== base.id).map(track => track.id));
  const overlays = project.clips.filter(clip => visibleIds.has(clipTrackId(project, clip)));
  // Other videos/audio need the complete compositor and its audio mixer.
  if(overlays.some(clip => intersects(clip) && (clip.kind === 'video' || clip.kind === 'audio'))) return null;
  const canReuse = !overlays.some(clip => clip.transition !== 'none' || clip.presetTransition);
  const seen = new Map<string, number>(); const overlayFrames: number[] = []; const overlayRuns: OverlayRun[] = [];
  const signatures = overlays.map(clip => ({clip, state: overlaySignature(clip, project.fps)}));
  for(let frame = firstFrame; frame <= lastFrame; frame++) {
    // A held outgoing visual may extend beyond its nominal duration. In that
    // case render every frame rather than incorrectly reusing an earlier image.
    const key = canReuse ? JSON.stringify(signatures.filter(({clip}) => frame >= clip.start && frame < clip.start + clip.duration).map(({clip, state}) => [clip.id, state(frame - clip.start)])) : String(frame);
    let representative = seen.get(key);
    if(representative === undefined) {representative = frame; seen.set(key, frame); overlayFrames.push(frame);}
    const previous = overlayRuns.at(-1);
    if(previous?.frame === representative) previous.duration++;
    else overlayRuns.push({frame: representative, duration: 1});
  }
  // No overlay at any point: FFmpeg can handle the entire export directly.
  if(!overlays.some(intersects)) return {baseTrackId: base.id, firstFrame, lastFrame, segments, overlayFrames: [], overlayRuns: []};
  return {baseTrackId: base.id, firstFrame, lastFrame, segments, overlayFrames, overlayRuns};
}

function overlaySignature(clip: Clip, fps: number): (frame: number) => unknown {
  if(visualProperties.some(property => clip.keyframes?.[property]?.length)) return frame => frame;
  if(clip.kind === 'graphic' && clip.graphic) {
    const {definition, values: input, duration} = clip.graphic;
    const values = resolvePresetValues(definition, input);
    const fields = ['x', 'y', 'width', 'height', 'opacity', 'rotation', 'scale', 'fontSize', 'radius', 'strokeWidth'] as const;
    return frame => {
      const progress = Math.min(1, (frame + (clip.motionOffset ?? 0)) / Math.max(1, Math.round(duration * fps) - 1));
      return [zoomAtFrame(clip, frame), ...definition.layers.flatMap(layer => fields.map(field => scalarAt(layer[field], progress, values)))];
    };
  }
  if(clip.kind === 'text' && !clip.caption && clip.animation === 'none') return () => 0;
  // Dynamic text/captions/images/custom behavior remain frame-exact, uncached.
  return frame => frame;
}

export function overlayRunsForSegment(plan: LayeredRenderPlan, segment: VideoSegment): OverlayRun[] {
  const result: OverlayRun[] = []; let cursor = plan.firstFrame;
  for(const run of plan.overlayRuns) {
    const start = Math.max(cursor, segment.start); const end = Math.min(cursor + run.duration, segment.start + segment.duration);
    if(end > start) result.push({frame: run.frame, duration: end - start});
    cursor += run.duration;
    if(cursor >= segment.start + segment.duration) break;
  }
  return result;
}
