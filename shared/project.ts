import {masterMixSchema} from './audio-mixer-settings';
import {markerSchema, folderSchema, organizationCommands, applyOrganization, validateOrganization} from './project-organization';
import {sequenceCommands, applySequenceCommand, activeSequenceId, validateSequences} from './project-sequences';
import {z} from 'zod';
import {animationCommandSchema, animationEditPatch} from './animation-editing';
import {canvasSettingsSchema, dimensionSchema, exportSettingsSchema, fpsSchema, type ExportSettings} from './media-settings';
import {updateCanvasSettings} from './project-settings';
import {presetInstanceSchema} from './asset-presets';
import {audioEnvelopeSchema, shiftAudioEnvelope} from './audio-envelope';
import {acceptsClip, clipTrackId, projectTracks, trackSchema, trackTypeName} from './tracks';
import {editTimelineRanges, timelineRangeEditSchema} from './timeline-ranges';
import {audioProcessingSchema} from './audio-effects';
import {colorLutSchema, lutValues} from './color-lut';
import {colorGradeSchema} from './color-grading';
import {cropSchema, maskSchema, reframeVisualKeyframes, visualKeyframesSchema} from './visual-editing';
import {speedProcessingSchema} from './speed-ramping';
import {applyEditorialCommand, editorialCommandSchemas, relatedClipIds, placeTimelineClip} from './editorial-tools';

export const effectNames = ['none', 'fade', 'slide', 'diagonal', 'pixel'] as const;
export const assetSchema = z.object({
  folderId: z.string().min(1).max(150).nullable().optional(),
  id: z.string().min(1), name: z.string().min(1).max(240),
  kind: z.enum(['video', 'image', 'audio']), src: z.string(), previewSrc: z.string().optional(), thumbnail: z.string().optional(),
  duration: z.number().positive(), width: z.number().optional(), height: z.number().optional(),
  demo: z.boolean().optional(),
  videoCodec: z.string().optional(),
  colorMetadata: z.object({matrix:z.string().optional(),transfer:z.string().optional(),primaries:z.string().optional(),range:z.string().optional(),pixelFormat:z.string().optional()}).optional(),
  hasAudio: z.boolean().optional(),
  fps: z.number().positive().optional(),
  audioProcessing: audioProcessingSchema.optional(),
  speedProcessing: speedProcessingSchema.optional(),
});
export const clipSchema = z.object({
  groupId: z.string().min(1).max(100).nullable().optional(), linkId: z.string().min(1).max(100).nullable().optional(),
  id: z.string().min(1), name: z.string().min(1).max(240),
  kind: z.enum(['video', 'image', 'audio', 'text', 'annotation', 'graphic', 'sequence']), sequenceId: z.string().min(1).max(100).optional(), assetId: z.string().optional(),
  graphic: presetInstanceSchema.optional(), presetTransition: presetInstanceSchema.nullable().optional(),
  track: z.enum(['visual', 'text', 'audio']), start: z.number().int().nonnegative(),
  trackId: z.string().min(1).max(100).optional(),
  duration: z.number().int().min(1), sourceStart: z.number().int().nonnegative().default(0),
  volume: z.number().min(0).max(1).default(1),
  audioEnvelope: audioEnvelopeSchema.nullable().optional(),
  audioDucking: audioEnvelopeSchema.nullable().optional(),
  autoAudio: z.object({reportId:z.string().uuid(),candidateId:z.string()}).optional(),
  x: z.number().min(0).max(100).default(50), y: z.number().min(0).max(100).default(50),
  scale: z.number().min(0.1).max(4).default(1),
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().finite().min(-36000).max(36000).default(0),
  crop: cropSchema.nullable().optional(), mask: maskSchema.nullable().optional(),
  keyframes: visualKeyframesSchema.nullable().optional(),
  positionLocked: z.boolean().default(false).describe('Preserve x/y while locked. Only explicitly unlock when the user requests it.'),
  colorGrade: colorGradeSchema.nullable().optional(),
  motionOffset: z.number().int().safe().optional(),
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
export const timelineSchema = z.object({
  audioMix: masterMixSchema.nullable().optional(),
  markers: z.array(markerSchema).optional(),
  width: dimensionSchema, height: dimensionSchema, fps: fpsSchema,
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), masterVolume: z.number().min(0).max(1).optional(), exportSettings: exportSettingsSchema.optional(),
  clips: z.array(clipSchema),
  colorGrade: colorGradeSchema.nullable().optional(),
  tracks: z.array(trackSchema).max(64).optional(),
});
export const sequenceSchema = timelineSchema.extend({id: z.string().min(1).max(100), name: z.string().trim().min(1).max(120)});
export const projectSchema = timelineSchema.extend({
  version: z.literal(1), id: z.string(), name: z.string().min(1).max(120), revision: z.number().int().nonnegative(),
  colorLuts: z.array(colorLutSchema).optional(),
  assets: z.array(assetSchema).max(1000), folders: z.array(folderSchema).max(500).optional(),
  // Root timeline is authoritative for the active sequence; only inactive timelines are stored here.
  sequenceId: z.string().min(1).max(100).optional(), sequenceName: z.string().trim().min(1).max(120).optional(),
  sequences: z.array(sequenceSchema).optional(),
});
export type Sequence = z.infer<typeof sequenceSchema>;
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
  animationCommandSchema,
  z.object({type:z.literal('project.audio-mix'),mix:masterMixSchema.nullable()}),
  z.object({type: z.literal('color-lut.add'), lut: colorLutSchema}),
  ...sequenceCommands,
  ...editorialCommandSchemas,
  ...organizationCommands,
  z.object({type: z.literal('project.color-grade'), grade: colorGradeSchema.nullable()}),
  timelineRangeEditSchema.extend({type: z.literal('timeline.edit-ranges')}),
  z.object({type: z.literal('clip.add'), clip: clipSchema}),
  z.object({type: z.literal('clip.detach-audio'), id: z.string(), newClipId: z.string().min(1), newAssetId: z.string().min(1), linkId: z.string().min(1).max(100)}),
  z.object({type: z.literal('timeline.place'), clip: clipSchema, mode: z.enum(['insert', 'overwrite'])}),
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
export interface Snapshot {project: Project; canUndo: boolean; canRedo: boolean; activity: Activity[]; recoveryNotice?: string}
export interface RenderJob {id: string; sequenceId?: string; sequenceName?: string; kind: 'video' | 'frame'; status: 'queued' | 'rendering' | 'done' | 'error'; progress: number; phase?: string; detail?: string; encoder?: string; warning?: string; url?: string; error?: string; frame?: number; revision: number; settings?: ExportSettings; filename?: string; outputPath?: string}

export function validateProject(project: Project): Project {
  projectSchema.parse(project);
  validateSequences(project, validateTimeline);
  return validateTimeline(project);
}

function validateTimeline(project: Project): Project {
  validateOrganization(project);
  const lutIds = new Set((project.colorLuts ?? []).map(lut => lut.id));
  if(lutIds.size !== (project.colorLuts?.length ?? 0)) throw new Error('Duplicate color LUT id.');
  for(const grade of [project.colorGrade, ...project.clips.map(clip => clip.colorGrade)]) if(grade?.lut && !lutIds.has(grade.lut.id)) throw new Error('A referenced color LUT is missing from the project.');
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
    if((clip.audioEnvelope || clip.audioDucking) && clip.kind !== 'video' && clip.kind !== 'audio' && clip.kind !== 'sequence') throw new Error('Audio envelopes require a video or audio clip');
    if(clip.colorGrade && clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'sequence') throw new Error('Color grading requires a video or image clip');
    if(clip.kind === 'audio' && (clip.crop || clip.mask || clip.keyframes || clip.rotation)) throw new Error('Crop, masks and transform keyframes require a visual element');
    if(clip.zoom && clip.track !== 'visual') throw new Error('Zoom requires a visual clip');
    if(clip.presetTransition && (clip.track !== 'visual' || clip.presetTransition.definition.category !== 'transition')) throw new Error('A transition preset requires a visual clip');
    if(clip.graphic && clip.kind !== 'graphic') throw new Error('Graphic recipes require a graphic clip');
    if(clip.kind === 'sequence') {
      if(clip.track !== 'visual' || !clip.sequenceId || clip.assetId) throw new Error('Nested sequences require a sequence reference on a video track.');
      continue;
    }
    if(clip.sequenceId) throw new Error('Only nested sequence clips can reference a sequence.');
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
    if(clip.kind !== 'image' && clip.sourceStart + clip.duration > Math.floor(asset.duration * project.fps + 1e-7)) throw new Error('Trim exceeds the source duration');
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
    case 'sequence.create': case 'sequence.open': case 'sequence.rename': case 'sequence.remove': case 'sequence.insert': applySequenceCommand(project, command, input => clipSchema.parse(input)); break;
    case 'marker.set': case 'marker.remove': case 'folder.add': case 'folder.update': case 'folder.remove': case 'assets.move-folder': applyOrganization(project, command); break;
    case 'clips.group': case 'clips.link': case 'clips.move': case 'clip.trim': case 'clip.slip': case 'clip.roll': case 'timeline.ripple-delete': case 'timeline.close-gap': applyEditorialCommand(project, command); break;
    case 'project.color-grade': project.colorGrade = command.grade; break;
    case 'timeline.edit-ranges': {const result = editTimelineRanges(project, {operation: command.operation, ranges: command.ranges, trackIds: command.trackIds}); project.clips = result.clips.map(attach); if(result.markers) project.markers = result.markers; break;}
    case 'clip.add': project.clips.push(attach(command.clip)); break;
    case 'clip.detach-audio': {
      const video = find(command.id); const asset = project.assets.find(a => a.id === video.assetId);
      if(video.kind !== 'video' || !asset || asset.hasAudio === false) throw new Error('Choose a video containing audio.');
      if(video.linkId && project.clips.some(c => c.kind === 'audio' && c.linkId === video.linkId)) throw new Error('This video already has linked audio.');
      const linkId = video.linkId || command.linkId;
      const audioAsset = {...asset, id: command.newAssetId, kind: 'audio' as const, name: `${asset.name.slice(0, 220)} · audio`, previewSrc: undefined, thumbnail: undefined, width: undefined, height: undefined, videoCodec: undefined, fps: undefined};
      project.assets.push(audioAsset);
      project.clips.push(attach(clipSchema.parse({id: command.newClipId, name: `${video.name.slice(0, 220)} · audio`, kind: 'audio', assetId: audioAsset.id, track: 'audio',
        start: video.start, duration: video.duration, sourceStart: video.sourceStart, volume: video.volume, audioEnvelope: video.audioEnvelope, audioDucking: video.audioDucking, linkId, groupId: video.groupId})));
      video.linkId = linkId; video.volume = 0; video.audioEnvelope = undefined; video.audioDucking = undefined;
      break;
    }
    case 'timeline.place': placeTimelineClip(project, attach(command.clip), command.mode); break;
    case 'clips.replace': project.clips = command.clips.map(attach); break;
    case 'color-lut.add': {lutValues(command.lut); if(!project.colorLuts?.some(lut => lut.id === command.lut.id)) project.colorLuts = [...(project.colorLuts ?? []), command.lut]; break;}
    case 'clip.animate': {const clip = find(command.id); Object.assign(clip, animationEditPatch(clip, command.edit)); break;}
    case 'clip.update': {
      const clip = find(command.id);
      if(clip.audioEnvelope && command.patch.audioEnvelope === undefined && command.patch.sourceStart !== undefined && (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'sequence')) clip.audioEnvelope = shiftAudioEnvelope(clip.audioEnvelope, command.patch.sourceStart - clip.sourceStart);
      if(clip.audioDucking && command.patch.audioDucking === undefined && command.patch.sourceStart !== undefined && (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'sequence')) clip.audioDucking = shiftAudioEnvelope(clip.audioDucking, command.patch.sourceStart - clip.sourceStart);
      if(command.patch.motionOffset === undefined && command.patch.sourceStart !== undefined && (clip.kind === 'video' || clip.kind === 'sequence')) clip.motionOffset = (clip.motionOffset ?? 0) + command.patch.sourceStart - clip.sourceStart;
      Object.assign(clip, command.patch); break;
    }
    case 'clip.remove': find(command.id); project.clips = project.clips.filter(c => c.id !== command.id); break;
    case 'clip.move-track': {const clip = find(command.id); const track = findTrack(command.trackId); if(!acceptsClip(track, clip)) throw new Error('Choose a compatible track for this clip'); clip.trackId = track.id; clip.track = track.type; if(track.type !== 'visual') {clip.presetTransition = null; clip.transition = 'none'; clip.zoom = null;} break;}
    case 'clip.split': {
      const clip = find(command.id); const offset = command.frame - clip.start;
      if(offset <= 0 || offset >= clip.duration) throw new Error('Place the playhead inside the clip to split it');
      const members = relatedClipIds(project, [clip.id], true).map(find).filter(member => command.frame > member.start && command.frame < member.start + member.duration);
      const rightLink = clip.linkId ? `split:${command.newId}`.slice(0, 100) : null;
      for(const member of members) {
        const offset = command.frame - member.start;
        project.clips.push({...member, id: member.id === clip.id ? command.newId : `${command.newId}:${member.id}`, linkId: rightLink, name: `${member.name.slice(0, 232)} (split)`, start: command.frame, duration: member.duration - offset,
          sourceStart: member.sourceStart + (member.kind === 'video' || member.kind === 'audio' || member.kind === 'sequence' || member.caption ? offset : 0), motionOffset: (member.motionOffset ?? 0) + offset,
          ...(member.audioEnvelope ? {audioEnvelope: shiftAudioEnvelope(member.audioEnvelope, offset)} : {}),
          ...(member.audioDucking ? {audioDucking: shiftAudioEnvelope(member.audioDucking, offset)} : {}), transition: 'none', presetTransition: null});
        member.duration = offset;
      }
      break;
    }
    case 'asset.add': project.assets.push(command.asset); break;
    case 'project.rename': project.name = command.name; break;
    case 'project.clear': project.clips = []; if(project.markers) project.markers = []; break;
    case 'project.settings': Object.assign(project, updateCanvasSettings(project, command.settings)); break;
    case 'project.export-settings': project.exportSettings = command.settings; break;
    case 'track.add': project.tracks = [command.track, ...editableTracks()]; break;
    case 'project.audio-mix': project.audioMix = command.mix; break;
    case 'track.update': Object.assign(findTrack(command.id), command.patch); break;
    case 'track.move': {findTrack(command.id); const tracks = editableTracks(); const index = tracks.findIndex(t => t.id === command.id); const target = index + (command.direction === 'up' ? -1 : 1); if(target >= 0 && target < tracks.length) [tracks[index], tracks[target]] = [tracks[target], tracks[index]]; break;}
    case 'track.remove': {findTrack(command.id); if(project.clips.some(c => clipTrackId(project, c) === command.id)) throw new Error('Move or remove the clips on this track first'); project.tracks = editableTracks().filter(t => t.id !== command.id); break;}
    case 'track.clear': {findTrack(command.id); project.clips = project.clips.filter(c => clipTrackId(project, c) !== command.id); break;}
  }
  const positionCurve = (clip: Clip, property: 'x' | 'y') => JSON.stringify((clip.keyframes?.[property] ?? []).map(({frame: _frame, ...key}) => key));
  for(const clip of current.clips.filter(c => c.positionLocked && activeSequenceId(current) === activeSequenceId(project))) {
    const next = project.clips.find(c => c.id === clip.id);
    if(!next?.positionLocked) continue;
    // Retiming can quantize neighboring keys onto the same frame. Permit exactly
    // that timing conversion while retaining protection against new positions.
    const retimed = clip.duration !== next.duration && clip.keyframes ? reframeVisualKeyframes(clip.keyframes, next.duration / clip.duration) : null;
    const changedCurve = (property: 'x' | 'y') => positionCurve(next, property) !== positionCurve(clip, property)
      && (!retimed || JSON.stringify(next.keyframes?.[property] ?? []) !== JSON.stringify(retimed[property] ?? []));
    if(next.x !== clip.x || next.y !== clip.y || command.type !== 'project.settings' && (changedCurve('x') || changedCurve('y'))) throw new Error(`Position is locked for ${clip.name}. Unlock it before moving it.`);
  }
  project.revision = current.revision + 1;
  return validateProject(project);
}
