import {z} from 'zod';
import {colorGradeSchema} from './color-grading';
import {shiftAudioEnvelope} from './audio-envelope';
import type {Clip, Command, Project} from './project';
import {clipTrackId, projectTracks} from './tracks';

const frame = z.number().int().nonnegative().safe();
export const colorGradeRequestSchema = z.object({
  revision: frame, scope: z.enum(['clips', 'tracks', 'timeline']),
  clipIds: z.array(z.string().min(1)).min(1).optional(), trackIds: z.array(z.string().min(1)).min(1).optional(),
  ranges: z.array(z.object({start: frame, end: frame}).refine(range => range.end > range.start, 'Choose a nonempty timeline range')).min(1).optional(),
  grade: colorGradeSchema.partial().nullable(), apply: z.boolean().default(false),
}).strict();
export type ColorGradeRequest = z.infer<typeof colorGradeRequestSchema>;

/** Prepare grade changes without moving timeline content or rewriting original media. */
export function colorGradeCommands(project: Project, input: ColorGradeRequest): {commands: Command[]; affectedClipIds: string[]; splitCount: number} {
  const body = colorGradeRequestSchema.parse(input);
  if(body.scope !== 'clips' && body.clipIds || body.scope !== 'tracks' && body.trackIds) throw new Error('Use clipIds with clips scope, or trackIds with tracks scope.');
  const merge = (current: Clip['colorGrade']) => body.grade === null ? null : colorGradeSchema.parse({...current, ...body.grade});
  if(body.scope === 'timeline' && !body.ranges) return {commands: [{type: 'project.color-grade', grade: merge(project.colorGrade)}], affectedClipIds: project.clips.filter(clip => ['image', 'video'].includes(clip.kind)).map(clip => clip.id), splitCount: 0};
  if(body.scope === 'clips' && !body.clipIds || body.scope === 'tracks' && !body.trackIds) throw new Error('Choose clips or tracks for this grading scope.');
  if(body.clipIds) for(const id of body.clipIds) if(!project.clips.some(clip => clip.id === id && ['image', 'video'].includes(clip.kind))) throw new Error('Color grading targets imported video or image clips.');
  if(body.trackIds) for(const id of body.trackIds) if(!projectTracks(project).some(track => track.id === id && track.type === 'visual')) throw new Error('Choose video tracks for color grading.');
  const end = project.clips.reduce((maximum, clip) => Math.max(maximum, clip.start + clip.duration), Math.max(1, Math.round(project.fps)));
  if(body.ranges?.some(range => range.end > end)) throw new Error(`Grading ranges must end at or before timeline frame ${end}.`);
  const targets = project.clips.filter(clip => ['image', 'video'].includes(clip.kind)
    && (body.scope === 'timeline' || body.scope === 'clips' && body.clipIds!.includes(clip.id) || body.scope === 'tracks' && body.trackIds!.includes(clipTrackId(project, clip)))
    && (!body.ranges || body.ranges.some(range => range.start < clip.start + clip.duration && range.end > clip.start)));
  if(!targets.length) throw new Error('No video/image clips intersect this grading selection.');
  const ids = new Set(project.clips.map(clip => clip.id)); const replacements = new Map<string, Clip[]>();
  const newId = (original: string) => {let index = 2; while(ids.has(`${original}-grade-${index}`)) index++; const id = `${original}-grade-${index}`; ids.add(id); return id;};
  const fragment = (clip: Clip, start: number, end: number, id: string): Clip => {
    const offset = start - clip.start;
    return {...structuredClone(clip), id, start, duration: end - start,
      sourceStart: clip.sourceStart + (clip.kind === 'video' || clip.kind === 'audio' || clip.caption ? offset : 0),
      ...(offset ? {motionOffset: (clip.motionOffset ?? 0) + offset, audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, offset), transition: 'none' as const, presetTransition: null} : {})};
  };
  let splitCount = 0;
  for(const clip of targets) {
    const boundaries = [...new Set([clip.start, clip.start + clip.duration, ...(body.ranges ?? []).flatMap(range => [range.start, range.end]).filter(frame => frame > clip.start && frame < clip.start + clip.duration)])].sort((a, b) => a - b);
    if((clip.transition !== 'none' || clip.presetTransition) && boundaries.slice(1, -1).some(frame => frame < clip.start + Math.min(clip.transitionFrames, clip.duration))) throw new Error(`A grading boundary falls inside the entrance transition of ${clip.name}. Grade the whole clip or start the range after its transition.`);
    const pieces = boundaries.slice(0, -1).map((start, index) => {
      const piece = fragment(clip, start, boundaries[index + 1], index ? newId(clip.id) : clip.id);
      if(!body.ranges || body.ranges.some(range => range.start <= start && range.end > start)) piece.colorGrade = merge(clip.colorGrade);
      return piece;
    });
    replacements.set(clip.id, pieces); splitCount += pieces.length - 1;
  }
  const clips = project.clips.flatMap(clip => {
    if(replacements.has(clip.id)) return replacements.get(clip.id)!;
    const parents = clip.caption && replacements.get(clip.caption.parentClipId);
    if(!parents || parents.length === 1) return [clip];
    const boundaries = [...new Set([clip.start, clip.start + clip.duration, ...parents.flatMap(parent => [parent.start, parent.start + parent.duration]).filter(frame => frame > clip.start && frame < clip.start + clip.duration)])].sort((a, b) => a - b);
    const pieces = boundaries.slice(0, -1).map((start, index) => {
      const parent = parents.find(parent => parent.start <= start && parent.start + parent.duration > start);
      const piece = fragment(clip, start, boundaries[index + 1], newId(clip.id));
      piece.caption = {...piece.caption!, parentClipId: parent?.id ?? clip.caption!.parentClipId}; return piece;
    });
    pieces[0].id = clip.id; return pieces;
  });
  return {commands: [{type: 'clips.replace', clips}], affectedClipIds: targets.map(clip => clip.id), splitCount};
}
