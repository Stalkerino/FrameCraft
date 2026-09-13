import {durationOf, type Asset, type Clip, type Project} from './project';
import type {ExportSettings} from './media-settings';
import type {RenderBlocker} from './render-eligibility';
import {reframeProject} from './project-settings';
import {clipTrackId, projectTracks} from './tracks';
import {videoPlacement} from './video-placement';
import {isNeutralColorGrade} from './color-grading';
import {visualProperties} from './visual-editing';
import {shiftAudioEnvelope, type AudioEnvelope} from './audio-envelope';

export interface NativeGpuSegment {
  clipId: string; name: string; asset: Asset; start: number; duration: number; sourceStart: number;
  volume: number; audioEnvelope?: AudioEnvelope | null; audioGains?: {volume: number; envelope?: AudioEnvelope | null}[];
}
export interface NativeGpuPlan {firstFrame: number; frameCount: number; segments: NativeGpuSegment[]; blockers: RenderBlocker[]}

/** First native increment: full-canvas cuts and scaling. The same frame clock,
 * placement and audio envelope functions drive the existing preview. O(clips),
 * with no media reads or frame enumeration; unsupported effects stay explicit.
 */
export function nativeGpuPlan(original: Project, settings: ExportSettings): NativeGpuPlan {
  const project = reframeProject(original, settings.fps);
  const duration = durationOf(project);
  if(settings.startSeconds >= duration / project.fps || (settings.endSeconds ?? 0) > duration / project.fps + .000001) throw new Error('Export range must be inside the timeline.');
  const firstFrame = Math.floor(settings.startSeconds * settings.fps);
  const endFrame = Math.min(duration, Math.ceil((settings.endSeconds ?? duration / project.fps) * settings.fps));
  const blockers: RenderBlocker[] = [];
  const add = (code: string, message: string, clip?: Clip) => blockers.push({code, message, ...(clip ? {clipId: clip.id, clipName: clip.name} : {})});
  const tracks = new Map(projectTracks(project).map(track => [track.id, track]));
  const active = project.clips.filter(clip => !tracks.get(clipTrackId(project, clip))?.hidden && clip.start < endFrame && clip.start + clip.duration > firstFrame);
  if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec)) add('output-codec', 'Native GPU encoding requires H.264, H.265 or AV1.');
  if(settings.encoder !== 'amd' && settings.encoder !== 'nvidia') add('gpu-selection', 'Select AMD or NVIDIA explicitly.');
  if(Math.abs(project.width / project.height - settings.width / settings.height) > 1e-6) add('output-aspect', 'Changing the canvas aspect ratio needs native canvas composition, which is not implemented yet.');
  if(!isNeutralColorGrade(project.colorGrade)) add('color-grade', 'Timeline grading needs the native GPU effects stage, which is not implemented yet.');
  for(const clip of active) if(clip.kind !== 'video') {
    // Disabled/hidden audio has no effect on the export.
    if(clip.kind === 'audio' && (!settings.audio || tracks.get(clipTrackId(project, clip))?.muted)) continue;
    add(clip.kind === 'audio' ? 'audio-mix' : 'artwork', clip.kind === 'audio'
      ? 'Additional audio tracks need the native timeline mixer, which is not implemented yet.'
      : 'Text, images and asset recipes need the native GPU compositor, which is not implemented yet.', clip);
  }
  const videos = active.filter(clip => clip.kind === 'video').sort((a, b) => a.start - b.start);
  const segments: NativeGpuSegment[] = [];
  let cursor = firstFrame;
  for(const clip of videos) {
    const start = Math.max(firstFrame, clip.start); const end = Math.min(endFrame, clip.start + clip.duration);
    if(start > cursor) add('gap', 'An empty canvas interval needs the native GPU background generator, which is not implemented yet.', clip);
    if(start < cursor) add('overlap', 'Simultaneous video layers need the native GPU compositor, which is not implemented yet.', clip);
    cursor = Math.max(cursor, end);
    if(clip.transition !== 'none' || clip.presetTransition) add('transition', 'Transitions need the native GPU effects stage, which is not implemented yet.', clip);
    if(clip.zoom || visualProperties.some(property => clip.keyframes?.[property]?.length)) add('animation', 'Animated transforms need the native GPU effects stage, which is not implemented yet.', clip);
    if(clip.mask || clip.rotation) add('mask-rotation', 'Masks and rotation are not implemented in the native GPU stage yet.', clip);
    if((clip.opacity ?? 1) !== 1 || !isNeutralColorGrade(clip.colorGrade)) add('color-opacity', 'Grading and opacity are not implemented in the native GPU stage yet.', clip);
    const asset = project.assets.find(asset => asset.id === clip.assetId);
    if(!asset || asset.kind !== 'video' || !asset.width || !asset.height) {add('source-metadata', 'Import a video with known dimensions.', clip); continue;}
    const placement = videoPlacement(clip, asset, project, settings);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
    if(!placement || !near(placement.source.x, 0) || !near(placement.source.y, 0)
      || !near(placement.source.width, asset.width) || !near(placement.source.height, asset.height)
      || !near(placement.destination.x, 0) || !near(placement.destination.y, 0)
      || !near(placement.destination.width, settings.width) || !near(placement.destination.height, settings.height)) {
      add('geometry', 'This increment requires footage filling the canvas. Crop, borders and positioned layers need native composition.', clip);
    }
    const sourceStart = clip.sourceStart + start - clip.start;
    if(sourceStart + end - start > Math.floor(asset.duration * settings.fps + 1e-7)) add('source-range', 'This range would hold a frame beyond the end of the source.', clip);
    segments.push({clipId: clip.id, name: clip.name, asset, start, duration: end - start, sourceStart,
      volume: tracks.get(clipTrackId(project, clip))?.muted ? 0 : clip.volume * (project.masterVolume ?? 1),
      audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, start - clip.start)});
  }
  if(cursor < endFrame || !segments.length) add('gap', 'The export range must be completely covered by video cuts.');
  return {firstFrame, frameCount: endFrame - firstFrame, segments, blockers};
}

export function requireNativeGpuPlan(project: Project, settings: ExportSettings): NativeGpuPlan {
  const plan = nativeGpuPlan(project, settings);
  if(plan.blockers.length) throw new Error(`Native GPU export cannot render this range:\n${plan.blockers.map(blocker => `${blocker.clipName ? blocker.clipName + ': ' : ''}${blocker.message}`).join('\n')}\nChoose the compatible renderer to preserve these effects.`);
  return plan;
}
