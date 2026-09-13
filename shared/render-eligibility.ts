import {durationOf, type Clip, type Project} from './project';
import type {ExportSettings} from './media-settings';
import {clipTrackId, projectTracks, trackClips} from './tracks';
import {visualProperties} from './visual-editing';

export interface RenderBlocker {code: string; message: string; clipId?: string; clipName?: string}

/** Shared by the actual renderer and its read-only explanation. No frame rendering. */
export function layeredRenderEligibility(project: Project, settings: ExportSettings) {
  const blockers: RenderBlocker[] = [];
  const add = (code: string, message: string, clip?: Clip) => blockers.push({code, message, ...(clip ? {clipId: clip.id, clipName: clip.name} : {})});
  if([project.colorGrade,...project.clips.map(clip=>clip.colorGrade)].some(grade=>grade?.lut?.strength||grade?.space==='linear-srgb')) add('advanced-color', 'Advanced color uses the complete compositor with shared color shaders.');
  if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec)) add('output-codec', 'This output codec uses the complete Remotion composition.');
  if(Math.abs(project.width / project.height - settings.width / settings.height) > 1e-6) add('output-aspect', 'Changing the output aspect ratio uses the complete composition.');
  const tracks = [...projectTracks(project)].filter(track => !track.hidden).reverse();
  const base = tracks.find(track => track.type === 'visual');
  if(!base) {add('no-base-track', 'No visible base video track is available for native rendering.'); return {blockers, baseTrackId: undefined};}
  const last = durationOf(project) - 1;
  const firstFrame = Math.min(last, Math.floor(settings.startSeconds * settings.fps));
  const lastFrame = Math.min(last, Math.ceil((settings.endSeconds ?? durationOf(project) / project.fps) * settings.fps) - 1);
  const intersects = (clip: Clip) => clip.start <= lastFrame && clip.start + clip.duration > firstFrame;
  let cursor = firstFrame;
  for(const clip of trackClips(project, base.id).filter(intersects)) {
    const asset = project.assets.find(asset => asset.id === clip.assetId);
    if(clip.kind !== 'video') add('base-artwork', 'A graphic or image on the base track needs the complete composition.', clip);
    else if(!asset || !asset.width || !asset.height) add('source-metadata', 'Video dimensions are missing from this source.', clip);
    if(clip.zoom) add('zoom', 'Animated zoom currently uses the complete composition.', clip);
    if(clip.transition !== 'none' || clip.presetTransition) add('transition', 'This transition currently uses the complete composition.', clip);
    if(clip.rotation) add('rotation', 'Video rotation currently uses the complete composition.', clip);
    if(clip.mask) add('mask', 'This mask currently uses the complete composition.', clip);
    if(visualProperties.some(property => clip.keyframes?.[property]?.length)) add('keyframes', 'Animated visual properties currently use the complete composition.', clip);
    const start = Math.max(firstFrame, clip.start);
    if(start < cursor) add('overlap', 'Overlapping base clips need the complete composition.', clip);
    cursor = Math.min(lastFrame + 1, clip.start + clip.duration);
  }
  const otherTracks = new Set(tracks.filter(track => track.id !== base.id).map(track => track.id));
  for(const clip of project.clips) if(otherTracks.has(clipTrackId(project, clip)) && intersects(clip)) {
    if(clip.kind === 'video' || clip.kind === 'sequence') add('additional-video', 'Another video track needs the complete compositor.', clip);
    if(clip.kind === 'audio') add('additional-audio', 'A separate audio track currently selects the complete composition and audio mixer.', clip);
  }
  return {blockers, baseTrackId: base.id};
}
