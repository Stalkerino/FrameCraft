import {namespaceScene, sliceScene} from './native-sequence-plan';
import {projectForSequence, sequenceSource} from './project-sequences';
import {durationOf, type Clip, type Project} from './project';
import {reframeProject} from './project-settings';
import {projectTracks, clipTrackId, trackClips} from './tracks';
import type {ExportSettings} from './media-settings';
import type {RenderBlocker} from './render-eligibility';
import type {NativeGpuSegment} from './native-gpu-plan';
import {colorGradeStages, type ColorGradeStage} from './color-grading';
import {outputVideoPlacement} from './composition-layout';
import type {VideoPlacement} from './video-placement';
import {shiftAudioEnvelope} from './audio-envelope';
import {transitionHold} from './transition-timing';
import type {NativeAnimation} from './gpu-animation';
import type {PresetInstance} from './asset-presets';
import {nativeMaskVertexBudget} from './mask-geometry';

export interface NativeVisualLayer extends NativeGpuSegment {placement: VideoPlacement; trackId: string; opacity: number; gradeStages: ColorGradeStage[]; animation?: NativeAnimation; artwork?: PresetInstance; textClip?: Clip; holdFrame?: boolean; scene?: {span: NativeSceneSpan; width: number; height: number; background: string}}
export interface NativeSceneSpan {start: number; duration: number; layers: NativeVisualLayer[]; audio: NativeGpuSegment[]}
export interface NativeScenePlan {firstFrame: number; frameCount: number; background: string; spans: NativeSceneSpan[]; blockers: RenderBlocker[]}

/** Sweep clip boundaries, not every frame. Each span has a stable set of
 * sources in the same painter order as ProjectScene. Audio keeps every audible
 * layer, including fully occluded/out-of-canvas video clips.
 */
export function nativeScenePlan(original: Project, settings: ExportSettings): NativeScenePlan {
  const project = reframeProject(original, settings.fps);
  const duration = durationOf(project);
  if(settings.startSeconds >= duration / project.fps || (settings.endSeconds ?? 0) > duration / project.fps + .000001) throw new Error('Export range must be inside the timeline.');
  const firstFrame = Math.floor(settings.startSeconds * settings.fps + 1e-7);
  const endFrame = Math.min(duration, Math.ceil((settings.endSeconds ?? duration / project.fps) * settings.fps - 1e-7));
  const tracks = [...projectTracks(project)].filter(track => !track.hidden).reverse();
  const order = new Map(tracks.map((track, index) => [track.id, index]));
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const blockers: RenderBlocker[] = [];
  const add = (code: string, message: string, clip?: Clip) => blockers.push({code, message, ...(clip ? {clipId: clip.id, clipName: clip.name} : {})});
  if(settings.encoder !== 'amd' && settings.encoder !== 'nvidia') add('gpu-selection', 'Select AMD or NVIDIA explicitly.');
  if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec)) add('output-codec', 'Vulkan Video requires H.264, H.265 or AV1 output.');
  const holds = new Map<string, number>();
  for(const track of tracks.filter(track => track.type === 'visual')) {
    const clips = trackClips(project, track.id);
    clips.forEach((clip, index) => holds.set(clip.id, transitionHold(clip, clips[index + 1])));
  }
  const bottomVisual = tracks.find(track => track.type === 'visual')?.id;
  const active = project.clips.filter(clip => order.has(clipTrackId(project, clip)) && clip.start < endFrame && clip.start + clip.duration + (holds.get(clip.id) ?? 0) > firstFrame);
  type Entry = {clip: Clip; segment: NativeGpuSegment; placement: VideoPlacement | null; trackId: string; child?: NativeScenePlan};
  const events = new Map<number, {add: Entry[]; remove: string[]}>();
  const event = (frame: number) => {if(!events.has(frame)) events.set(frame, {add: [], remove: []}); return events.get(frame)!;};
  event(firstFrame); event(endFrame);
  for(const clip of active) {
    const trackId = clipTrackId(project, clip); const track = tracks[order.get(trackId)!];
    if(clip.kind === 'audio' && (!settings.audio || track.muted || clip.volume === 0 || project.masterVolume === 0)) continue;
    if(clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'audio' && clip.kind !== 'graphic' && clip.kind !== 'text' && clip.kind !== 'sequence') {add('artwork', 'This visual element still needs the compatible renderer.', clip); continue;}
    // Generated geometry has no media file. This internal canvas descriptor
    // never enters the project asset repository or image preparation path.
    const generated = clip.kind === 'text' || clip.kind === 'graphic' && clip.graphic;
    const nested = clip.kind === 'sequence';
    const child = nested ? reframeProject(projectForSequence(original, clip.sequenceId!), settings.fps) : undefined;
    let childPlan: NativeScenePlan | undefined;
    if(child) {
      const sourceFirst = clip.sourceStart + Math.min(Math.max(firstFrame, clip.start) - clip.start, clip.duration - 1);
      const sourceEnd = Math.min(durationOf(child), clip.sourceStart + Math.min(endFrame - clip.start, clip.duration));
      childPlan = sourceFirst < sourceEnd
        ? namespaceScene(nativeScenePlan(child, {...settings, width: child.width, height: child.height, startSeconds: sourceFirst / settings.fps, endSeconds: sourceEnd / settings.fps, fit: 'contain'}), clip.id)
        : {firstFrame: sourceFirst, frameCount: 0, background: child.backgroundColor ?? '#080c0e', spans: [], blockers: []};
    }
    if(childPlan) blockers.push(...childPlan.blockers.map(blocker => ({...blocker, clipId: clip.id, clipName: `${clip.name} / ${blocker.clipName ?? 'sequence'}`})));
    const asset = nested ? sequenceSource(original, clip) : generated ? {id: `native-artwork:${clip.id}`, name: clip.name, kind: 'image' as const, src: '', width: project.width, height: project.height, duration: Infinity} : assets.get(clip.assetId ?? '');
    if(!asset || !generated && !nested && asset.kind !== clip.kind || clip.kind !== 'audio' && (!asset.width || !asset.height)) {add('source-metadata', 'A matching imported source with known dimensions is required.', clip); continue;}
    if(!generated && asset.kind === 'image' && /\.(svg|gif|tiff?|bmp)(?:$|[?#])/i.test(asset.src)) add('image-format', 'Native imported images support PNG, JPEG, WebP and AVIF. SVG and other image formats require the compatible renderer.', clip);
    if(clip.kind !== 'audio') {
      if(clip.mask?.shape === 'polygon' && clip.mask.points.length > nativeMaskVertexBudget) add('mask-complexity', `Native masks allow ${nativeMaskVertexBudget} vertices per polygon to bound GPU work. Simplify this mask or use the compatible renderer.`, clip);
    }
    const start = Math.max(firstFrame, clip.start); const end = Math.min(endFrame, clip.start + clip.duration + (holds.get(clip.id) ?? 0));
    const sourceStart = clip.sourceStart + Math.min(start - clip.start, clip.duration - 1);
    if(!nested && clip.kind !== 'image' && clip.sourceStart + Math.min(end - clip.start, clip.duration) > Math.floor(asset.duration * settings.fps + 1e-7)) add('source-range', 'This range extends past the source duration.', clip);
    const entry: Entry = {clip, trackId, child: childPlan, placement: clip.kind !== 'audio' ? outputVideoPlacement(clip, asset, project, settings) : null,
      segment: {clipId: clip.id, name: clip.name, asset, start, duration: end - start, sourceStart, volume: track.muted ? 0 : clip.volume * (project.masterVolume ?? 1), audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, start - clip.start)}};
    event(start).add.push(entry); event(end).remove.push(clip.id);
    if(childPlan) for(const span of childPlan.spans) for(const boundary of [span.start, span.start + span.duration]) {
      const mapped = clip.start + boundary - clip.sourceStart;
      if(mapped > start && mapped < Math.min(end, clip.start + clip.duration)) event(mapped);
    }
    const naturalEnd = clip.start + clip.duration;
    if(naturalEnd > start && naturalEnd < end) event(naturalEnd);
  }
  const live = new Map<string, Entry>(); const spans: NativeSceneSpan[] = [];
  const boundaries = [...events.keys()].sort((a, b) => a - b);
  const seenOverlap = new Set<string>();
  for(let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]; const end = boundaries[index + 1]; const change = events.get(start)!;
    for(const id of change.remove) live.delete(id);
    for(const entry of change.add) live.set(entry.clip.id, entry);
    const entries = [...live.values()].sort((a, b) => order.get(a.trackId)! - order.get(b.trackId)! || a.clip.start - b.clip.start);
    const occupied = new Set<string>(); const layers: NativeVisualLayer[] = []; const audio: NativeGpuSegment[] = [];
    for(const entry of entries) {
      const offset = start - entry.segment.start;
      const held = start >= entry.clip.start + entry.clip.duration;
      const segment = {...entry.segment, start, duration: end - start, sourceStart: entry.clip.sourceStart + Math.min(start - entry.clip.start, entry.clip.duration - 1), audioEnvelope: shiftAudioEnvelope(entry.segment.audioEnvelope, offset)};
      if(settings.audio && !held && segment.volume > 0 && (entry.clip.kind === 'video' || entry.clip.kind === 'audio')) audio.push(segment);
      if(entry.clip.kind === 'audio') continue;
      if(!held && occupied.has(entry.trackId) && !seenOverlap.has(entry.clip.id) && tracks[order.get(entry.trackId)!].type === 'visual') {add('same-track-overlap', 'Place simultaneous videos on separate tracks for native composition.', entry.clip); seenOverlap.add(entry.clip.id);}
      if(!held) occupied.add(entry.trackId);
      const clip = entry.clip;
      const animated = !!(clip.kind === 'sequence' || clip.kind === 'text' || clip.graphic || clip.presetTransition || clip.zoom || clip.mask || clip.rotation || clip.transition !== 'none' || holds.get(clip.id) || (['x', 'y', 'scale', 'rotation', 'opacity'] as const).some(property => clip.keyframes?.[property]?.length));
      const animation: NativeAnimation | undefined = animated ? {clip: {x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation, opacity: clip.opacity, crop: clip.crop, mask: clip.mask, keyframes: clip.keyframes, zoom: clip.zoom, motionOffset: clip.motionOffset,
        duration: clip.duration, transition: clip.transition, transitionFrames: clip.transitionFrames, presetTransition: clip.presetTransition}, project: {width: project.width, height: project.height}, localFrame: Math.min(start - clip.start, clip.duration - 1), held, opaque: entry.trackId === bottomVisual} : undefined;
      const placement = animation ? {source: {x: 0, y: 0, width: settings.width, height: settings.height}, destination: {x: 0, y: 0, width: settings.width, height: settings.height}} : entry.placement;
      let scene: NativeVisualLayer['scene'];
      if(entry.child) {
        const sourceFrame = clip.sourceStart + Math.min(start - clip.start, clip.duration - 1);
        const childSpan = entry.child.spans.find(span => sourceFrame >= span.start && sourceFrame < span.start + span.duration);
        const sampled = childSpan ? sliceScene(childSpan, sourceFrame, end - start, held) : {start: sourceFrame, duration: end - start, layers: [], audio: []};
        scene = {span: sampled, width: entry.segment.asset.width!, height: entry.segment.asset.height!, background: entry.child.background};
        if(settings.audio && !held && segment.volume > 0) audio.push(...sampled.audio.map(child => ({...child, start, duration: end - start,
          audioGains: [...(child.audioGains ?? []), {volume: segment.volume, envelope: segment.audioEnvelope}]})));
      }
      if(placement && (animation || clip.opacity !== 0)) layers.push({...segment, placement, trackId: entry.trackId,
        ...(scene ? {scene} : {}), opacity: clip.opacity ?? 1, gradeStages: clip.kind === 'graphic' || clip.kind === 'text' ? [] : colorGradeStages(clip.colorGrade, project.colorGrade, project.colorLuts), ...(animation ? {animation} : {}), ...(clip.graphic ? {artwork: clip.graphic} : {}), ...(clip.kind === 'text' ? {textClip: clip} : {})});
    }
    spans.push({start, duration: end - start, layers, audio});
  }
  return {firstFrame, frameCount: endFrame - firstFrame, background: project.backgroundColor ?? '#080c0e', spans, blockers};
}

export function requireNativeScenePlan(project: Project, settings: ExportSettings) {
  const plan = nativeScenePlan(project, settings);
  if(plan.blockers.length) throw new Error(`Native Vulkan export cannot render this range:\n${plan.blockers.map(b => `${b.clipName ? b.clipName + ': ' : ''}${b.message}`).join('\n')}\nChoose the compatible renderer to preserve these effects.`);
  return plan;
}
