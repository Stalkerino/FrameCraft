import {insertMarkerTime} from './project-organization';
import {z} from 'zod';
import type {Clip, Project} from './project';
import {clipTrackId} from './tracks';
import {shiftAudioEnvelope} from './audio-envelope';
import {editTimelineRanges} from './timeline-ranges';

const ids = z.array(z.string().min(1)).min(1);
const delta = z.number().int().safe();
export const editorialCommandSchemas = [
  z.object({type: z.literal('clips.group'), ids, groupId: z.string().min(1).max(100).nullable()}),
  z.object({type: z.literal('clips.link'), ids, linkId: z.string().min(1).max(100).nullable()}),
  z.object({type: z.literal('clips.move'), ids, delta}),
  z.object({type: z.literal('clip.trim'), id: z.string(), edge: z.enum(['start', 'end']), delta, ripple: z.boolean().default(false), linked: z.boolean().default(true)}),
  z.object({type: z.literal('clip.slip'), id: z.string(), delta, linked: z.boolean().default(true)}),
  z.object({type: z.literal('clip.roll'), id: z.string(), delta}),
  z.object({type: z.literal('timeline.ripple-delete'), ids}),
  z.object({type: z.literal('timeline.close-gap'), frame: z.number().int().nonnegative()}),
] as const;
export type EditorialCommand = z.infer<typeof editorialCommandSchemas[number]>;

export function relatedClipIds(project: Pick<Project, 'clips'>, selected: string[], linksOnly = false): string[] {
  const result = new Set(selected); let changed = true;
  while(changed) {
    changed = false;
    const members = project.clips.filter(c => result.has(c.id));
    const groups = new Set(members.flatMap(c => !linksOnly && c.groupId ? [c.groupId] : []));
    const links = new Set(members.flatMap(c => c.linkId ? [c.linkId] : []));
    for(const clip of project.clips) if(!result.has(clip.id) && (clip.groupId && groups.has(clip.groupId) || clip.linkId && links.has(clip.linkId))) {result.add(clip.id); changed = true;}
  }
  return [...result];
}

function offsetSource(clip: Clip, delta: number) {
  if(['audio', 'video', 'sequence'].includes(clip.kind) || clip.caption) clip.sourceStart += delta;
  clip.motionOffset = (clip.motionOffset ?? 0) + delta;
  if(clip.audioEnvelope) clip.audioEnvelope = shiftAudioEnvelope(clip.audioEnvelope, delta);
  if(clip.audioDucking) clip.audioDucking = shiftAudioEnvelope(clip.audioDucking, delta);
}
function trim(project: Project, id: string, edge: 'start' | 'end', amount: number, linked: boolean) {
  const anchor = project.clips.find(c => c.id === id); if(!anchor) throw new Error('Clip no longer exists');
  const boundary = edge === 'start' ? anchor.start : anchor.start + anchor.duration;
  const members = new Set(linked ? relatedClipIds(project, [id], true) : [id]);
  for(const clip of project.clips) if(members.has(clip.id) && (edge === 'start' ? clip.start : clip.start + clip.duration) === boundary) {
    if(edge === 'start') {clip.start += amount; clip.duration -= amount; offsetSource(clip, amount);} else clip.duration += amount;
  }
}

/** Mutates the reducer's isolated draft. The shared project validator checks
 * source bounds and positive durations before the transaction can be saved. */
export function applyEditorialCommand(project: Project, command: EditorialCommand) {
  const find = (id: string) => {const clip = project.clips.find(c => c.id === id); if(!clip) throw new Error('Clip no longer exists'); return clip;};
  if('ids' in command) for(const id of command.ids) find(id);
  switch(command.type) {
    case 'clips.group': case 'clips.link': {
      const value = command.type === 'clips.group' ? command.groupId : command.linkId;
      if(value && new Set(command.ids).size < 2) throw new Error('Select at least two clips.');
      const key = command.type === 'clips.group' ? 'groupId' : 'linkId';
      for(const id of command.ids) find(id)[key] = value;
      break;
    }
    case 'clips.move': {
      const selected = new Set(relatedClipIds(project, command.ids));
      for(const clip of project.clips) if(selected.has(clip.id)) clip.start += command.delta;
      break;
    }
    case 'clip.slip': {
      const anchor = find(command.id);
      if(!['audio', 'video', 'sequence'].includes(anchor.kind)) throw new Error('Slip editing requires video or audio.');
      for(const id of command.linked ? relatedClipIds(project, [command.id], true) : [command.id]) offsetSource(find(id), command.delta);
      break;
    }
    case 'clip.trim': {
      const clip = find(command.id); const boundary = command.edge === 'start' ? clip.start : clip.start + clip.duration;
      if(command.ripple) {
        if(command.edge !== 'end') throw new Error('Ripple trim currently uses the end edge.');
        if(command.delta < 0) {
          if(-command.delta >= clip.duration) throw new Error('Ripple trim must retain at least one frame of the selected clip.');
          const result = editTimelineRanges(project, {operation: 'remove', ranges: [{start: boundary + command.delta, end: boundary}]}); project.clips = result.clips; if(result.markers) project.markers = result.markers;
          break;
        }
        const linkedIds = new Set(relatedClipIds(project, [clip.id], true));
        if(project.clips.some(c => !linkedIds.has(c.id) && c.start < boundary && c.start + c.duration > boundary)) throw new Error('Another clip spans this cut. Split it at the cut before extending with ripple trim.');
        insertMarkerTime(project, boundary, command.delta);
        for(const following of project.clips) if(following.start >= boundary) following.start += command.delta;
      }
      trim(project, command.id, command.edge, command.delta, command.linked); break;
    }
    case 'clip.roll': {
      const clip = find(command.id); const end = clip.start + clip.duration;
      const neighbours = project.clips.filter(c => c.id !== clip.id && clipTrackId(project, c) === clipTrackId(project, clip) && c.start === end);
      if(neighbours.length !== 1) throw new Error('Roll requires one adjacent clip on the same track.');
      trim(project, neighbours[0].id, 'start', command.delta, true);
      trim(project, clip.id, 'end', command.delta, true); break;
    }
    case 'timeline.ripple-delete': {
      const selected = new Set(relatedClipIds(project, command.ids));
      const result = editTimelineRanges(project, {operation: 'remove', ranges: project.clips.filter(c => selected.has(c.id)).map(c => ({start: c.start, end: c.start + c.duration}))}); project.clips = result.clips; if(result.markers) project.markers = result.markers;
      break;
    }
    case 'timeline.close-gap': {
      if(project.clips.some(c => c.start <= command.frame && c.start + c.duration > command.frame)) throw new Error('Place the playhead in a gap empty on every track.');
      const start = Math.max(0, ...project.clips.filter(c => c.start + c.duration <= command.frame).map(c => c.start + c.duration));
      const ends = project.clips.filter(c => c.start > command.frame).map(c => c.start);
      if(!ends.length) throw new Error('There is no clip after this gap.');
      const result = editTimelineRanges(project, {operation: 'remove', ranges: [{start, end: Math.min(...ends)}]}); project.clips = result.clips; if(result.markers) project.markers = result.markers; break;
    }
  }
}

function fragment(clip: Clip, start: number, end: number, id: string): Clip {
  const result = structuredClone(clip); const offset = start - clip.start;
  result.id = id; result.start = start; result.duration = end - start;
  offsetSource(result, offset);
  if(offset) {result.transition = 'none'; result.presetTransition = null;}
  return result;
}

export function placeTimelineClip(project: Project, inserted: Clip, mode: 'insert' | 'overwrite') {
  const start = inserted.start; const end = start + inserted.duration;
  const rightParents = new Map(project.clips.filter(c => c.kind === 'video' && c.start < start && c.start + c.duration > start).map(c => [c.id, `${c.id}:insert:${inserted.id}`]));
  const result: Clip[] = [];
  for(const clip of project.clips) {
    const finish = clip.start + clip.duration;
    if(mode === 'insert') {
      if(clip.start >= start) result.push({...clip, start: clip.start + inserted.duration});
      else if(finish <= start) result.push(clip);
      else {
        result.push(fragment(clip, clip.start, start, clip.id));
        const right = fragment(clip, start, finish, `${clip.id}:insert:${inserted.id}`);
        right.start += inserted.duration;
        if(right.linkId) right.linkId = `insert:${inserted.id}:${right.linkId}`.slice(0, 100);
        result.push(right);
      }
    } else if(clipTrackId(project, clip) !== clipTrackId(project, inserted) || finish <= start || clip.start >= end) result.push(clip);
    else {
      if(clip.start < start) result.push(fragment(clip, clip.start, start, clip.id));
      if(finish > end) result.push(fragment(clip, end, finish, clip.start < start ? `${clip.id}:overwrite:${inserted.id}` : clip.id));
    }
  }
  if(mode === 'insert') for(const clip of result) {
    if(clip.caption && clip.start >= end && rightParents.has(clip.caption.parentClipId)) clip.caption = {...clip.caption, parentClipId: rightParents.get(clip.caption.parentClipId)!};
  }
  if(mode === 'insert') insertMarkerTime(project, start, inserted.duration);
  project.clips = [...result, inserted];
}
