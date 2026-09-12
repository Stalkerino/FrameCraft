import {createHash} from 'node:crypto';
import {toJsonSchemaCompat} from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {clipSchema, commandSchema, type Command} from '../../shared/project';
import {trackSchema} from '../../shared/tracks';

const revision = z.number().int().nonnegative();
const id = () => z.string().min(1).max(100);
const frame = () => z.number().int().nonnegative();
const placement = {start: frame(), duration: z.number().int().positive(), trackId: id()};
const visual = clipSchema.pick({x: true, y: true, scale: true, opacity: true}).partial().shape;
const typography = clipSchema.pick({fontSize: true, color: true, align: true, weight: true}).partial().shape;
const changes = clipSchema.pick({name: true, start: true, duration: true, sourceStart: true, x: true, y: true, scale: true, opacity: true, rotation: true, text: true, fontSize: true, color: true, align: true, weight: true, volume: true, positionLocked: true, animation: true, transition: true, transitionFrames: true}).partial().shape;

/** Small, single-action contracts for Ollama. The full MCP tools remain available. */
const schemas = {
  add_text_clip: z.object({revision, ...placement, text: z.string().min(1).max(2000), clipId: id().optional(), ...visual, ...typography, animation: z.enum(['none', 'rise', 'typewriter']).default('none')}).strict(),
  add_media_clip: z.object({revision, ...placement, kind: z.enum(['video', 'image', 'audio']), assetId: id(), clipId: id().optional(), name: z.string().min(1).max(240).optional(), sourceStart: frame().default(0), volume: z.number().min(0).max(1).optional(), ...visual}).strict(),
  update_clip: z.object({revision, clipId: id(), ...changes}).strict(),
  split_clip: z.object({revision, clipId: id(), frame: frame(), newClipId: id().optional()}).strict(),
  remove_clip: z.object({revision, clipId: id()}).strict(),
  move_clip_to_track: z.object({revision, clipId: id(), trackId: id()}).strict(),
  add_track: z.object({revision, type: trackSchema.shape.type, name: trackSchema.shape.name, trackId: id().optional()}).strict(),
  move_track: z.object({revision, trackId: id(), direction: z.enum(['up', 'down'])}).strict(),
  clear_track: z.object({revision, trackId: id()}).strict(),
  rename_project: z.object({revision, name: z.string().trim().min(1).max(120)}).strict(),
};
type EditorToolName = keyof typeof schemas;
const descriptions: Record<EditorToolName, string> = {
  add_text_clip: 'Add text on an existing text track. start/duration are TIMELINE FRAMES at project fps; x/y are center percentages, fontSize is pixels. Default animation=none. Read get_project for revision and trackId. Returns updated project with clip ID.',
  add_media_clip: 'Place an already imported video/image/audio on a compatible track. start/duration are TIMELINE FRAMES; sourceStart is SOURCE FRAMES at PROJECT fps (default 0), never seconds or source fps. x/y are center percentages. Read get_project for revision, assetId and trackId.',
  update_clip: 'Change only supplied fields on one clip; pass at least one change. start/duration/transitionFrames use TIMELINE FRAMES, sourceStart uses SOURCE FRAMES at PROJECT fps. x/y are center percentages; opacity/volume are 0..1. Keep positionLocked unless explicitly asked to unlock. This trims/moves, not speed retiming.',
  split_clip: 'Split a clip at an absolute TIMELINE FRAME strictly inside it. Retains media, timing and synchronized source offsets; creates a second clip. Read get_project for revision and clipId.',
  remove_clip: 'Remove one clip from the timeline without deleting its source media or shifting other clips. Read get_project for revision and clipId.',
  move_clip_to_track: 'Move one clip to a compatible track without changing its timeline start. Read get_project for revision, clipId and trackId.',
  add_track: 'Add a track at the top: visual for video/images, text for text/graphics, audio for sound. Read get_project for revision. Returns updated project with track ID.',
  move_track: 'Move a track one position up or down in the layer stack; clip timing stays fixed. Read get_project for revision and trackId.',
  clear_track: 'Remove ALL clips from one specified track, keeping the track, source media and other tracks. Use only when requested. Read get_project for revision and trackId.',
  rename_project: 'Rename the current project without switching projects. Read get_project for revision.',
};
const labels: Record<EditorToolName, string> = {
  add_text_clip: 'Add text', add_media_clip: 'Add media clip', update_clip: 'Update clip', split_clip: 'Split clip', remove_clip: 'Remove clip',
  move_clip_to_track: 'Move clip to track', add_track: 'Add track', move_track: 'Move track', clear_track: 'Clear track', rename_project: 'Rename project',
};

export const ollamaEditorTools: Tool[] = (Object.keys(schemas) as EditorToolName[]).map(name => {
  const {$schema: _dialect, ...schema} = toJsonSchemaCompat(schemas[name]);
  // In a partial update, omitted fields stay unchanged. Creation defaults are
  // applied by the domain schema, not advertised as values to resend on updates.
  schema.properties = Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([key, {default: _default, description: _description, ...field}]) => [key, field]));
  return {name, description: descriptions[name], inputSchema: schema as Tool['inputSchema']};
});
export const isOllamaEditorTool = (name: string): name is EditorToolName => Object.hasOwn(schemas, name);
export interface PreparedOllamaEditorTool {name: 'edit_project'; arguments: {revision: number; label: string; commands: Command[]}}

// Same validated request/revision produces the same ID, including across retries.
// The editor still checks revisions and duplicate IDs; this never replays a mutation.
function generatedId(kind: 'clip' | 'track', name: string, args: Record<string, unknown>) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(args).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  return `local-${kind}-${createHash('sha256').update(name + '\n' + canonical).digest('hex').slice(0, 24)}`;
}

/** Returns an ordinary edit_project call for the existing approval/MCP path.
 * This adapter never fetches revisions, executes commands, or changes MCP contracts.
 */
export function prepareOllamaEditorTool(name: string, input: Record<string, unknown>): PreparedOllamaEditorTool | undefined {
  if(!isOllamaEditorTool(name)) return undefined;
  const args = schemas[name].parse(input);
  let command: unknown;
  switch(name) {
    case 'add_text_clip': {
      const {revision: _revision, clipId, ...clip} = schemas.add_text_clip.parse(args);
      command = {type: 'clip.add', clip: {...clip, id: clipId ?? generatedId('clip', name, args), name: clip.text.slice(0, 240), kind: 'text', track: 'text'}};
      break;
    }
    case 'add_media_clip': {
      const {revision: _revision, clipId, ...clip} = schemas.add_media_clip.parse(args);
      command = {type: 'clip.add', clip: {...clip, id: clipId ?? generatedId('clip', name, args), name: clip.name ?? `${clip.kind} clip`, track: clip.kind === 'audio' ? 'audio' : 'visual'}};
      break;
    }
    case 'update_clip': {
      const {revision: _revision, clipId, ...patch} = schemas.update_clip.parse(args);
      if(!Object.keys(patch).some(key => patch[key as keyof typeof patch] !== undefined)) throw new Error('update_clip needs at least one changed field, such as start, duration, text or opacity.');
      command = {type: 'clip.update', id: clipId, patch};
      break;
    }
    case 'split_clip': {
      const value = schemas.split_clip.parse(args);
      command = {type: 'clip.split', id: value.clipId, frame: value.frame, newId: value.newClipId ?? generatedId('clip', name, args)};
      break;
    }
    case 'remove_clip': command = {type: 'clip.remove', id: schemas.remove_clip.parse(args).clipId}; break;
    case 'move_clip_to_track': {
      const value = schemas.move_clip_to_track.parse(args);
      command = {type: 'clip.move-track', id: value.clipId, trackId: value.trackId}; break;
    }
    case 'add_track': {
      const value = schemas.add_track.parse(args);
      command = {type: 'track.add', track: {id: value.trackId ?? generatedId('track', name, args), name: value.name, type: value.type}}; break;
    }
    case 'move_track': {
      const value = schemas.move_track.parse(args);
      command = {type: 'track.move', id: value.trackId, direction: value.direction}; break;
    }
    case 'clear_track': command = {type: 'track.clear', id: schemas.clear_track.parse(args).trackId}; break;
    case 'rename_project': command = {type: 'project.rename', name: schemas.rename_project.parse(args).name}; break;
  }
  return {name: 'edit_project', arguments: {revision: args.revision, label: labels[name], commands: [commandSchema.parse(command)]}};
}
