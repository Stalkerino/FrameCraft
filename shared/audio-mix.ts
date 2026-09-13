import {z} from 'zod';
import {duckingKeyframes} from './audio-ducking';
import type {Command, Project} from './project';
import {clipTrackId, projectTracks} from './tracks';

export const audioDuckSchema = z.object({revision: z.number().int().nonnegative(), targetClipIds: z.array(z.string().min(1)).min(1), triggerTrackIds: z.array(z.string().min(1)).min(1), gain: z.number().min(0).max(1).default(.25), attackFrames: z.number().int().nonnegative().default(6), releaseFrames: z.number().int().nonnegative().default(12), apply: z.boolean().default(false)});
export function audioDuckCommands(project: Project, input: z.infer<typeof audioDuckSchema>): Command[] {
  const body = audioDuckSchema.parse(input); const tracks = projectTracks(project);
  if(new Set(body.targetClipIds).size !== body.targetClipIds.length) throw new Error('Choose each target clip once.');
  for(const id of body.triggerTrackIds) if(!tracks.some(track => track.id === id && ['audio', 'visual'].includes(track.type))) throw new Error('Choose existing video/audio tracks to trigger ducking.');
  const audible = project.clips.filter(clip => ['audio', 'video', 'sequence'].includes(clip.kind) && clip.volume > 0 && !body.targetClipIds.includes(clip.id)
    && body.triggerTrackIds.includes(clipTrackId(project, clip)) && !tracks.find(track => track.id === clipTrackId(project, clip))?.muted);
  return body.targetClipIds.map(id => {
    const clip = project.clips.find(item => item.id === id);
    if(!clip || !['audio', 'video', 'sequence'].includes(clip.kind)) throw new Error('Select audio/video clips to lower.');
    const ranges = audible.map(trigger => ({start: trigger.start - clip.start, end: trigger.start + trigger.duration - clip.start}))
      .filter(range => range.start - body.attackFrames < clip.duration && range.end + body.releaseFrames > 0);
    if(!ranges.length) throw new Error(`No foreground clips overlap ${clip.name}. Choose a track containing the voice or action audio.`);
    return {type: 'clip.update', id, patch: {audioEnvelope: {duration: clip.duration, offset: 0, fadeIn: 0, fadeOut: 0,
      keyframes: duckingKeyframes(clip.duration, ranges, {gain: body.gain, attack: body.attackFrames, release: body.releaseFrames})}}};
  });
}
