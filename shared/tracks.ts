import {z} from 'zod';
import type {Clip, Project} from './project';
export const trackTypeSchema = z.enum(['visual', 'text', 'audio']);
export const trackSchema = z.object({id: z.string().min(1).max(100), type: trackTypeSchema, name: z.string().trim().min(1).max(60), muted: z.boolean().default(false), hidden: z.boolean().default(false)});
export type Track = z.infer<typeof trackSchema>;
export const defaultTracks: Track[] = [
  {id: 'text', type: 'text', name: 'Text 1', muted: false, hidden: false},
  {id: 'visual', type: 'visual', name: 'Video 1', muted: false, hidden: false},
  {id: 'audio', type: 'audio', name: 'Audio 1', muted: false, hidden: false},
];
export const projectTracks = (project: Pick<Project, 'tracks'>): Track[] => project.tracks ?? defaultTracks;
export const clipTrackId = (project: Pick<Project, 'tracks'>, clip: Pick<Clip, 'trackId' | 'track'>): string => clip.trackId ?? projectTracks(project).find(t => t.id === clip.track && t.type === clip.track)?.id ?? projectTracks(project).find(t => t.type === clip.track)?.id ?? clip.track;
export const trackClips = (project: Project, trackId: string) => project.clips.filter(c => clipTrackId(project, c) === trackId).sort((a, b) => a.start - b.start);
export const acceptsClip = (track: Track, clip: Pick<Clip, 'track' | 'kind'>) => clip.kind === 'graphic' ? track.type !== 'audio' : track.type === clip.track;
export const trackTypeName = (type: Track['type']) => type === 'visual' ? 'Video' : type === 'text' ? 'Text' : 'Audio';
export function normalizeProjectTracks(project: Project): Project {const tracks = structuredClone(projectTracks(project)); return {...project, tracks, clips: project.clips.map(clip => ({...clip, trackId: clipTrackId({tracks}, clip)}))};}
