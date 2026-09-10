import type {Clip, Project} from './project';
import {acceptsClip, clipTrackId, projectTracks} from './tracks';
import {reframeProject} from './project-settings';

export const canSplitAt = (clip: Clip | undefined, frame: number) => !!clip && Number.isInteger(frame) && frame > clip.start && frame < clip.start + clip.duration;

/** Explicit selection wins; otherwise use the chosen track, then the top visible clip. */
export function splitTarget(project: Project, selectedId: string | null, trackId: string | null, frame: number) {
  if(selectedId) return project.clips.find(c => c.id === selectedId);
  const tracks = projectTracks(project).filter(t => trackId ? t.id === trackId : !t.hidden);
  return tracks.flatMap(t => project.clips.filter(c => clipTrackId(project, c) === t.id)).find(c => canSplitAt(c, frame));
}

export interface TimelineClipboard {projectId: string; fps: number; clip: Clip; clips?: Clip[]}

/** Copies the complete edit, including source trim, animation offsets and saved recipes. */
export function copyTimelineClip(project: Project, source: Clip, id: string, start: number, trackId: string | null, sourceFps = project.fps): Clip {
  const tracks = projectTracks(project);
  const target = trackId ? tracks.find(t => t.id === trackId) : tracks.find(t => t.id === clipTrackId(project, source)) ?? tracks.find(t => acceptsClip(t, source));
  if(!target || !acceptsClip(target, source)) throw new Error('Select a compatible track before pasting this clip.');
  if(source.assetId && !project.assets.some(a => a.id === source.assetId)) throw new Error('The copied clip’s media is no longer in this project.');
  const clip = reframeProject({...project, fps: sourceFps, clips: [structuredClone(source)]}, project.fps).clips[0];
  return {...clip, id, name: `${source.name.slice(0, 235)} copy`, start: Math.max(0, Math.round(start)), trackId: target.id, track: target.type,
    ...(target.type !== 'visual' ? {transition: 'none', presetTransition: null, zoom: null} : {})};
}
