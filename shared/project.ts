import {z} from 'zod';
import {canvasSettingsSchema, dimensionSchema, exportSettingsSchema, fpsSchema, type ExportSettings} from './media-settings';
import {updateCanvasSettings} from './project-settings';
import {presetInstanceSchema} from './asset-presets';
import {audioEnvelopeSchema, shiftAudioEnvelope} from './audio-envelope';
import {acceptsClip, clipTrackId, projectTracks, trackSchema, trackTypeName} from './tracks';
import {editTimelineRanges, timelineRangeEditSchema} from './timeline-ranges';
import {audioProcessingSchema} from './audio-effects';

export const effectNames = ['none', 'fade', 'slide', 'diagonal', 'pixel'] as const;
export const assetSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(240),
  kind: z.enum(['video', 'image', 'audio']), src: z.string(), previewSrc: z.string().optional(), thumbnail: z.string().optional(),
  duration: z.number().positive(), width: z.number().optional(), height: z.number().optional(),
  demo: z.boolean().optional(),
  videoCodec: z.string().optional(),
  fps: z.number().positive().optional(),
  audioProcessing: audioProcessingSchema.optional(),
});
export const clipSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(240),
  kind: z.enum(['video', 'image', 'audio', 'text', 'annotation', 'graphic']), assetId: z.string().optional(),
  graphic: presetInstanceSchema.optional(), presetTransition: presetInstanceSchema.nullable().optional(),
  track: z.enum(['visual', 'text', 'audio']), start: z.number().int().nonnegative(),
  trackId: z.string().min(1).max(100).optional(),
  duration: z.number().int().min(1), sourceStart: z.number().int().nonnegative().default(0),
  volume: z.number().min(0).max(1).default(1),
  audioEnvelope: audioEnvelopeSchema.nullable().optional(),
  x: z.number().min(0).max(100).default(50), y: z.number().min(0).max(100).default(50),
  scale: z.number().min(0.1).max(4).default(1),
  positionLocked: z.boolean().default(false).describe('Preserve x/y while locked. Only explicitly unlock when the user requests it.'),
  motionOffset: z.number().int().nonnegative().optional(),
  text: z.string().max(2000).default(''), fontSize: z.number().min(4).max(2000).default(88),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  weight: z.enum(['400', '600', '800']).default('800'),
  animation: z.enum(['none', 'rise', 'typewriter']).default('rise'),
  transition: z.enum(effectNames).default('none'), transitionFrames: z.number().int().min(1).max(864000).default(18),
  caption: z.object({parentClipId: z.string(), style: z.enum(['clean', 'highlight', 'boxed']), highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), words: z.array(z.object({text: z.string().max(300), start: z.number().int().nonnegative(), end: z.number().int().positive()})).min(1).max(100)}).nullable().optional(),
  annotation: z.object({shape: z.enum(['arrow', 'box', 'circle']), width: z.number().min(2).max(100), height: z.number().min(2).max(100), rotation: z.number().min(-180).max(180), stroke: z.number().min(.1).max(300)}).optional(),
  zoom: z.object({from: z.number().min(1).max(4), to: z.number().min(1).max(4), x: z.number().min(0).max(100), y: z.number().min(0).max(100), start: z.number().int().nonnegative(), end: z.number().int().positive()}).refine(v => v.end > v.start, 'Zoom end must follow its start').nullable().optional(),
});
export const projectSchema = z.object({
  version: z.literal(1), id: z.string(), name: z.string().min(1).max(120),
  revision: z.number().int().nonnegative(), width: dimensionSchema, height: dimensionSchema, fps: fpsSchema,
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), masterVolume: z.number().min(0).max(1).optional(), exportSettings: exportSettingsSchema.optional(),
  assets: z.array(assetSchema).max(1000), clips: z.array(clipSchema),
  tracks: z.array(trackSchema).max(64).optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Project = z.infer<typeof projectSchema>;
export type EffectName = typeof effectNames[number];
export const durationOf = (project: Project) => project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), Math.max(1, Math.round(project.fps)));
export const formatTime = (frames: number, fps = 30) => {
  const seconds = Math.floor(frames / fps);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
export const formatTimecode = (frames: number, fps = 30) => `${formatTime(frames, fps)}:${String(Math.floor(frames - Math.floor(frames / fps) * fps + 1e-7)).padStart(2, '0')}`;

export const commandSchema = z.discriminatedUnion('type', [
  timelineRangeEditSchema.extend({type: z.literal('timeline.edit-ranges')}),
  z.object({type: z.literal('clip.add'), clip: clipSchema}),
  z.object({type: z.literal('clips.replace'), clips: z.array(clipSchema)}),
  z.object({type: z.literal('clip.update'), id: z.string(), patch: clipSchema.omit({id: true, kind: true, track: true, assetId: true}).partial()}),
  z.object({type: z.literal('clip.remove'), id: z.string()}),
  z.object({type: z.literal('clip.move-track'), id: z.string(), trackId: z.string()}),
  z.object({type: z.literal('clip.split'), id: z.string(), frame: z.number().int(), newId: z.string().min(1)}),
  z.object({type: z.literal('asset.add'), asset: assetSchema}),
  z.object({type: z.literal('project.rename'), name: z.string().trim().min(1).max(120)}),
  z.object({type: z.literal('project.clear')}),
  z.object({type: z.literal('project.settings'), settings: canvasSettingsSchema}),
  z.object({type: z.literal('project.export-settings'), settings: exportSettingsSchema}),
  z.object({type: z.literal('track.add'), track: trackSchema}),
  z.object({type: z.literal('track.update'), id: z.string(), patch: trackSchema.omit({id: true, type: true}).partial()}),
  z.object({type: z.literal('track.move'), id: z.string(), direction: z.enum(['up', 'down'])}),
  z.object({type: z.literal('track.remove'), id: z.string()}),
  z.object({type: z.literal('track.clear'), id: z.string()}),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Activity {id: string; label: string; source: 'editor' | 'codex'; at: string}
export interface Snapshot {project: Project; canUndo: boolean; canRedo: boolean; activity: Activity[]}
export interface RenderJob {id: string; kind: 'video' | 'frame'; status: 'queued' | 'rendering' | 'done' | 'error'; progress: number; phase?: string; detail?: string; encoder?: string; warning?: string; url?: string; error?: string; frame?: number; revision: number; settings?: ExportSettings; filename?: string}

export function validateProject(project: Project): Project {
  projectSchema.parse(project);
  const ids = new Set<string>();
  const tracks = projectTracks(project); const trackIds = new Set(tracks.map(t => t.id));
  if(trackIds.size !== tracks.length) throw new Error('Duplicate track ID');
  for (const asset of project.assets) {if(ids.has(asset.id)) throw new Error('Duplicate asset ID'); ids.add(asset.id);}
  ids.clear();
  for (const clip of project.clips) {
    if(ids.has(clip.id)) throw new Error('Duplicate clip ID'); ids.add(clip.id);
    const track = tracks.find(t => t.id === clipTrackId(project, clip));
    if(!track || track.type !== clip.track) throw new Error('Clip needs a matching timeline track');
    if(clip.caption && clip.kind !== 'text') throw new Error('Captions require a text clip');
    if(clip.audioEnvelope && clip.kind !== 'video' && clip.kind !== 'audio') throw new Error('Audio envelopes require a video or audio clip');
    if(clip.zoom && clip.track !== 'visual') throw new Error('Zoom requires a visual clip');
    if(clip.presetTransition && (clip.track !== 'visual' || clip.presetTransition.definition.category !== 'transition')) throw new Error('A transition preset requires a visual clip');
    if(clip.graphic && clip.kind !== 'graphic') throw new Error('Graphic recipes require a graphic clip');
    if(clip.kind === 'graphic') {
      if(!clip.graphic || clip.graphic.definition.category === 'transition' || clip.track === 'audio') throw new Error('Graphics require a visual or overlay recipe');
      continue;
    }
    if (clip.kind === 'text' || clip.kind === 'annotation') {
      if(clip.track !== 'text') throw new Error('Overlays belong on the text track');
      if(clip.kind === 'annotation' && !clip.annotation) throw new Error('Choose an annotation shape');
      if(clip.caption?.words.some(w => w.end <= w.start)) throw new Error('Invalid caption word timing');
      continue;
    }
    const asset = project.assets.find(a => a.id === clip.assetId);
    if(!asset || asset.kind !== clip.kind) throw new Error('Clip needs a matching imported asset');
    if(clip.track !== (clip.kind === 'audio' ? 'audio' : 'visual')) throw new Error('Invalid track for this media');
    if(clip.kind !== 'image' && clip.sourceStart + clip.duration > Math.floor(asset.duration * project.fps)) throw new Error('Trim exceeds the source duration');
  }
  return project;
}

/** Pure command reducer: UI and MCP both pass through this boundary. */
export function applyCommand(current: Project, input: Command): Project {
  const command = commandSchema.parse(input);
  const project = structuredClone(current);
  const find = (id: string) => {const clip = project.clips.find(c => c.id === id); if(!clip) throw new Error('Clip no longer exists'); return clip;};
  const attach = (clip: Clip): Clip => {
    if(clip.trackId) return clip;
    let track = projectTracks(project).find(t => t.id === clip.track && t.type === clip.track) ?? projectTracks(project).find(t => t.type === clip.track);
    if(!track) {track = trackSchema.parse({id: clip.track, type: clip.track, name: `${trackTypeName(clip.track)} 1`}); project.tracks = [track, ...projectTracks(project)];}
    return {...clip, trackId: track.id};
  };
  const editableTracks = () => project.tracks ?? (project.tracks = structuredClone(projectTracks(project)));
  const findTrack = (id: string) => {const track = editableTracks().find(t => t.id === id); if(!track) throw new Error('Track no longer exists'); return track;};
  switch(command.type) {
    case 'timeline.edit-ranges': project.clips = editTimelineRanges(project, {operation: command.operation, ranges: command.ranges, trackIds: command.trackIds}).clips.map(attach); break;
    case 'clip.add': project.clips.push(attach(command.clip)); break;
    case 'clips.replace': project.clips = command.clips.map(attach); break;
    case 'clip.update': {
      const clip = find(command.id);
      if(clip.audioEnvelope && command.patch.audioEnvelope === undefined && command.patch.sourceStart !== undefined && (clip.kind === 'video' || clip.kind === 'audio')) clip.audioEnvelope = shiftAudioEnvelope(clip.audioEnvelope, command.patch.sourceStart - clip.sourceStart);
      Object.assign(clip, command.patch); break;
    }
    case 'clip.remove': find(command.id); project.clips = project.clips.filter(c => c.id !== command.id); break;
    case 'clip.move-track': {const clip = find(command.id); const track = findTrack(command.trackId); if(!acceptsClip(track, clip)) throw new Error('Choose a compatible track for this clip'); clip.trackId = track.id; clip.track = track.type; if(track.type !== 'visual') {clip.presetTransition = null; clip.transition = 'none'; clip.zoom = null;} break;}
    case 'clip.split': {
      const clip = find(command.id); const offset = command.frame - clip.start;
      if(offset <= 0 || offset >= clip.duration) throw new Error('Place the playhead inside the clip to split it');
      project.clips.push({...clip, id: command.newId, name: `${clip.name} (split)`, start: command.frame, duration: clip.duration - offset, sourceStart: clip.sourceStart + (clip.kind === 'video' || clip.kind === 'audio' || clip.caption ? offset : 0), motionOffset: (clip.motionOffset ?? 0) + offset, ...(clip.audioEnvelope ? {audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, offset)} : {}), transition: 'none', presetTransition: null});
      clip.duration = offset; break;
    }
    case 'asset.add': project.assets.push(command.asset); break;
    case 'project.rename': project.name = command.name; break;
    case 'project.clear': project.clips = []; break;
    case 'project.settings': Object.assign(project, updateCanvasSettings(project, command.settings)); break;
    case 'project.export-settings': project.exportSettings = command.settings; break;
    case 'track.add': project.tracks = [command.track, ...editableTracks()]; break;
    case 'track.update': Object.assign(findTrack(command.id), command.patch); break;
    case 'track.move': {findTrack(command.id); const tracks = editableTracks(); const index = tracks.findIndex(t => t.id === command.id); const target = index + (command.direction === 'up' ? -1 : 1); if(target >= 0 && target < tracks.length) [tracks[index], tracks[target]] = [tracks[target], tracks[index]]; break;}
    case 'track.remove': {findTrack(command.id); if(project.clips.some(c => clipTrackId(project, c) === command.id)) throw new Error('Move or remove the clips on this track first'); project.tracks = editableTracks().filter(t => t.id !== command.id); break;}
    case 'track.clear': {findTrack(command.id); project.clips = project.clips.filter(c => clipTrackId(project, c) !== command.id); break;}
  }
  for(const clip of current.clips.filter(c => c.positionLocked)) {
    const next = project.clips.find(c => c.id === clip.id);
    if(next?.positionLocked && (next.x !== clip.x || next.y !== clip.y)) throw new Error(`Position is locked for ${clip.name}. Unlock it before moving it.`);
  }
  project.revision = current.revision + 1;
  return validateProject(project);
}
