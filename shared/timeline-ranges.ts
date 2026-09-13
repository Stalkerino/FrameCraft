import {markersInWindows, type TimelineMarker} from './project-organization';
import {z} from 'zod';
import type {Clip, Project} from './project';
import {clipTrackId, projectTracks} from './tracks';
import {shiftAudioEnvelope} from './audio-envelope';

const frame = z.number().int().nonnegative().safe();
export const timelineRangeEditSchema = z.object({
  operation: z.enum(['remove', 'assemble']),
  ranges: z.array(z.object({start: frame, end: frame}).strict().refine(range => range.end > range.start, 'Choose a nonempty timeline range')).min(1),
  trackIds: z.array(z.string().min(1)).min(1).optional(),
}).strict();
export type TimelineRangeEdit = z.infer<typeof timelineRangeEditSchema>;
export type TimelineRange = TimelineRangeEdit['ranges'][number];
export interface TimelineRangeEditResult {
  clips: Clip[];
  markers?: TimelineMarker[];
  affectedClipCount: number;
  beforeDuration: number;
  afterDuration: number;
  ranges: TimelineRange[];
  trackIds: string[];
  warnings: string[];
}

interface Window extends TimelineRange {outputStart: number}
interface Fragment extends TimelineRange {clip: Clip; originalId: string; windowIndex: number}

// Match the editor's minimum one-second canvas without importing the command
// reducer: project.ts consumes this operation and must not form a runtime cycle.
const duration = (clips: Clip[], fps: number) => clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), Math.max(1, Math.round(fps)));

function mergedRanges(ranges: TimelineRange[]): TimelineRange[] {
  const result: TimelineRange[] = [];
  for(const range of ranges.map(range => ({...range})).sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if(previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push(range);
  }
  return result;
}

function selectedWindows(operation: TimelineRangeEdit['operation'], ranges: TimelineRange[], end: number): Window[] {
  const windows: Window[] = [];
  let outputStart = 0;
  if(operation === 'assemble') {
    for(const range of ranges) {
      windows.push({...range, outputStart});
      outputStart += range.end - range.start;
      if(!Number.isSafeInteger(outputStart)) throw new Error('The assembled timeline exceeds safe frame precision');
    }
  } else {
    let sourceStart = 0;
    for(const cut of ranges) {
      if(cut.start > sourceStart) {
        windows.push({start: sourceStart, end: cut.start, outputStart});
        outputStart += cut.start - sourceStart;
      }
      sourceStart = cut.end;
    }
    if(sourceStart < end) windows.push({start: sourceStart, end, outputStart});
  }
  return windows;
}

/**
 * Edit original, half-open timeline intervals across coordinated tracks.
 * This is pure: previews and commits produce the same collision-free IDs.
 * Assets and track definitions are never changed. Unselected tracks stay put.
 */
export function editTimelineRanges(project: Project, input: TimelineRangeEdit): TimelineRangeEditResult {
  const request = timelineRangeEditSchema.parse(input);
  const beforeDuration = duration(project.clips, project.fps);
  if(request.ranges.some(range => range.end > beforeDuration)) throw new Error(`Timeline ranges must end at or before frame ${beforeDuration}`);
  const tracks = projectTracks(project);
  const trackIds = request.trackIds ?? tracks.map(track => track.id);
  const selected = new Set(trackIds);
  if(!selected.size) throw new Error('Choose at least one timeline track');
  if(selected.size !== trackIds.length) throw new Error('Choose each timeline track only once');
  if(trackIds.some(id => !tracks.some(track => track.id === id))) throw new Error('Choose existing timeline tracks');
  const ranges = request.operation === 'remove' ? mergedRanges(request.ranges) : request.ranges.map(range => ({...range}));
  const markerEnd = Math.max(beforeDuration, ...(project.markers ?? []).map(m => (m.end ?? m.frame) + 1));
  const windows = selectedWindows(request.operation, ranges, request.operation === 'remove' ? markerEnd : beforeDuration);
  const occupiedIds = new Set(project.clips.map(clip => clip.id));
  const nextSuffix = new Map<string, number>();
  const nextId = (original: string) => {
    let suffix = nextSuffix.get(original) ?? 2;
    let id: string;
    do {id = `${original}-range-${suffix++}`;} while(occupiedIds.has(id));
    nextSuffix.set(original, suffix); occupiedIds.add(id); return id;
  };
  const clips: Clip[] = [];
  const fragments = new Map<string, Fragment[]>();
  const affected = new Set<string>();
  const selectedClipIds = new Set(project.clips.filter(clip => selected.has(clipTrackId(project, clip))).map(clip => clip.id));
  for(const original of project.clips) {
    if(!selectedClipIds.has(original.id)) {clips.push(structuredClone(original)); continue;}
    const retained: Fragment[] = [];
    for(const [windowIndex, window] of windows.entries()) {
      const start = Math.max(original.start, window.start);
      const end = Math.min(original.start + original.duration, window.end);
      if(end <= start) continue;
      const offset = start - original.start;
      const clip: Clip = {...structuredClone(original), id: retained.length ? nextId(original.id) : original.id,
        start: window.outputStart + start - window.start, duration: end - start};
      if(offset) {
        clip.audioEnvelope = shiftAudioEnvelope(clip.audioEnvelope, offset);
        clip.audioDucking = shiftAudioEnvelope(clip.audioDucking, offset);
        if(clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'sequence' || clip.caption) clip.sourceStart += offset;
        clip.motionOffset = (clip.motionOffset ?? 0) + offset;
        clip.transition = 'none'; clip.presetTransition = null;
      }
      retained.push({clip, originalId: original.id, windowIndex, start, end});
      clips.push(clip);
    }
    fragments.set(original.id, retained);
    if(retained.length !== 1 || retained[0].clip.start !== original.start || retained[0].clip.duration !== original.duration || retained[0].start !== original.start) affected.add(original.id);
  }

  const warnings = new Set<string>();
  for(const original of project.clips) {
    if(!original.caption) continue;
    const parentId = original.caption.parentClipId;
    const childSelected = selectedClipIds.has(original.id);
    const parentSelected = selectedClipIds.has(parentId);
    if(childSelected !== parentSelected) {
      warnings.add('Only some linked caption/source tracks were selected; unselected clips retain their existing timing. Review caption/source alignment.');
      continue;
    }
    if(!childSelected) continue;
    for(const fragment of fragments.get(original.id) ?? []) {
      const parent = fragments.get(parentId)?.find(candidate => candidate.windowIndex === fragment.windowIndex && candidate.start <= fragment.start && candidate.end >= fragment.end);
      if(!parent) {
        warnings.add('Some captions have no matching source fragment. Their text and timing were retained; review caption/source alignment.');
        continue;
      }
      if(fragment.clip.caption!.parentClipId !== parent.clip.id) {
        fragment.clip.caption!.parentClipId = parent.clip.id;
        affected.add(original.id);
      }
    }
  }
  return {clips, ...(project.markers ? {markers: selected.size === tracks.length ? markersInWindows(project.markers, windows, request.operation === 'assemble') : structuredClone(project.markers)} : {}), affectedClipCount: affected.size, beforeDuration, afterDuration: duration(clips, project.fps), ranges, trackIds: [...trackIds], warnings: [...warnings]};
}
