import {z} from 'zod';
import {clipSchema, type Clip, type Project} from './project';
import {transcriptSegments, type Transcript} from './transcript';
import {shiftAudioEnvelope} from './audio-envelope';

export const frameRangeSchema = z.object({start: z.number().int().nonnegative(), end: z.number().int().positive()}).refine(r => r.end > r.start, 'Choose a nonempty range');
export type FrameRange = z.infer<typeof frameRangeSchema>;
export function mergeRanges(ranges: FrameRange[]): FrameRange[] {
  const sorted = ranges.map(r => frameRangeSchema.parse(r)).sort((a, b) => a.start - b.start); const merged: FrameRange[] = [];
  for(const range of sorted) {const last = merged.at(-1); if(last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push({...range});}
  return merged;
}

/** Ripple every track together, splitting crossing clips and retaining their source offsets. */
export function removeTimelineRanges(project: Project, ranges: FrameRange[], id: () => string): Clip[] {
  const cuts = mergeRanges(ranges); const clips: Clip[] = [];
  const removedBefore = (frame: number) => cuts.reduce((sum, r) => sum + Math.max(0, Math.min(frame, r.end) - r.start), 0);
  for(const clip of project.clips) {
    let fragments = [{start: clip.start, end: clip.start + clip.duration}];
    for(const cut of cuts) fragments = fragments.flatMap(f => cut.end <= f.start || cut.start >= f.end ? [f] : [{start: f.start, end: Math.min(f.end, cut.start)}, {start: Math.max(f.start, cut.end), end: f.end}].filter(r => r.end > r.start));
    for(const [index, fragment] of fragments.entries()) {
      const offset = fragment.start - clip.start;
      clips.push({...clip, id: index === 0 ? clip.id : id(), start: fragment.start - removedBefore(fragment.start), duration: fragment.end - fragment.start, sourceStart: clip.sourceStart + (clip.kind === 'video' || clip.kind === 'audio' || clip.caption ? offset : 0), motionOffset: (clip.motionOffset ?? 0) + offset, ...(clip.audioEnvelope ? {audioEnvelope: shiftAudioEnvelope(clip.audioEnvelope, offset)} : {}), ...(clip.audioDucking ? {audioDucking: shiftAudioEnvelope(clip.audioDucking, offset)} : {}), transition: offset ? 'none' : clip.transition, presetTransition: offset ? null : clip.presetTransition});
    }
  }
  return clips;
}

export function transcriptRanges(project: Project, clipId: string, transcript: Transcript, wordIds: string[]): FrameRange[] {
  const clip = project.clips.find(c => c.id === clipId);
  if(!clip || clip.assetId !== transcript.assetId || !['video', 'audio'].includes(clip.kind)) throw new Error('Select a timeline clip using this transcript');
  const selected = new Set(wordIds); if(!selected.size || transcript.words.filter(w => selected.has(w.id)).length !== selected.size) throw new Error('Select valid transcript words');
  const ranges: FrameRange[] = []; let group: typeof transcript.words = [];
  const flush = () => {
    if(!group.length) return;
    const start = Math.max(clip.sourceStart, Math.floor(group[0].start * project.fps));
    const end = Math.min(clip.sourceStart + clip.duration, Math.ceil(group.at(-1)!.end * project.fps));
    if(end > start) ranges.push({start: clip.start + start - clip.sourceStart, end: clip.start + end - clip.sourceStart}); group = [];
  };
  for(const word of transcript.words) {if(selected.has(word.id)) group.push(word); else flush();} flush();
  if(!ranges.length) throw new Error('These words are outside the selected clip');
  return mergeRanges(ranges);
}

export const captionOptionsSchema = z.object({style: z.enum(['clean', 'highlight', 'boxed']).default('highlight'), wordsPerCaption: z.number().int().min(2).max(12).default(6), fontSize: z.number().min(24).max(100).default(52), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'), highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c5f277'), y: z.number().min(10).max(95).default(84)});
export type CaptionOptions = z.infer<typeof captionOptionsSchema>;
export function createCaptions(project: Project, clipId: string, transcript: Transcript, options: CaptionOptions, id: () => string): Clip[] {
  const clip = project.clips.find(c => c.id === clipId); if(!clip || clip.assetId !== transcript.assetId) throw new Error('Select a clip with this transcript');
  const words = transcript.words.filter(w => w.text.trim() && w.end * project.fps > clip.sourceStart && w.start * project.fps < clip.sourceStart + clip.duration);
  if(!words.length) throw new Error('No transcribed speech in this clip');
  const groups: typeof words[] = []; let group: typeof words = [];
  for(const word of words) {
    if(group.length && (group.length >= options.wordsPerCaption || word.start - group.at(-1)!.end > .6 || word.end - group[0].start > 4)) {groups.push(group); group = [];}
    group.push(word); if(/[.!?]$/.test(word.text)) {groups.push(group); group = [];}
  }
  if(group.length) groups.push(group);
  return groups.map(group => {
    const sourceStart = Math.max(clip.sourceStart, Math.floor(group[0].start * project.fps));
    const end = Math.min(clip.sourceStart + clip.duration, Math.ceil(group.at(-1)!.end * project.fps));
    return clipSchema.parse({id: id(), kind: 'text', track: 'text', name: 'Captions', text: group.map(w => w.text).join(' '), start: clip.start + sourceStart - clip.sourceStart, sourceStart: 0, duration: Math.max(1, end - sourceStart), fontSize: options.fontSize, y: options.y, color: options.color, animation: 'none', caption: {parentClipId: clipId, style: options.style, highlightColor: options.highlightColor, words: group.map(w => ({text: w.text, start: Math.max(0, Math.floor(w.start * project.fps) - sourceStart), end: Math.max(1, Math.ceil(w.end * project.fps) - sourceStart)}))}});
  });
}

export function captionsToSubtitles(project: Project, format: 'srt' | 'vtt'): string {
  const captions = project.clips.filter(c => c.caption).sort((a, b) => a.start - b.start);
  const timestamp = (frames: number) => {const ms = Math.round(frames / project.fps * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;};
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + captions.map((clip, index) => `${index + 1}\n${timestamp(clip.start)} --> ${timestamp(clip.start + clip.duration)}\n${captionText(clip).replace(/-->/g, '→')}\n`).join('\n');
}

export interface RoughCutShot {assetId: string; sourceStart: number; duration: number; reason: string; text: string}
export interface RoughCutProposal {revision: number; title: string; shots: RoughCutShot[]; totalFrames: number; warnings: string[]}
export function proposeRoughCut(project: Project, transcripts: Transcript[], assetIds: string[], seconds: number, topic: string, rankedIds: string[] = []): RoughCutProposal {
  const selected = assetIds.map(id => project.assets.find(a => a.id === id)).filter(a => a !== undefined);
  if(selected.length !== assetIds.length || !selected.length) throw new Error('Choose available media for the first cut');
  const budget = Math.round(seconds * project.fps); const shots: (RoughCutShot & {id: string})[] = []; let remaining = budget;
  const candidates = selected.flatMap(asset => {
    const transcript = transcripts.find(t => t.assetId === asset.id);
    if(transcript?.words.length) return transcriptSegments(transcript).map(segment => ({id: `${asset.id}:${segment.id}`, assetId: asset.id, sourceStart: Math.max(0, Math.floor(segment.start * project.fps)), duration: Math.min(Math.floor(asset.duration * project.fps), Math.ceil(segment.end * project.fps)) - Math.max(0, Math.floor(segment.start * project.fps)), text: segment.text, reason: topic ? 'Relevant spoken passage' : 'Complete spoken passage'}));
    return [{id: asset.id, assetId: asset.id, sourceStart: 0, duration: Math.min(Math.floor(asset.duration * project.fps), 6 * project.fps), text: '', reason: 'Opening shot · no transcript'}];
  });
  const ranks = new Map(rankedIds.map((id, index) => [id, index]));
  const ordered = [...candidates].sort((a, b) => (ranks.get(a.id) ?? 100000) - (ranks.get(b.id) ?? 100000));
  for(const candidate of ordered) {
    if(candidate.duration < 1 || remaining < 1) continue;
    // Keep complete spoken passages rather than cutting a sentence to hit an exact duration.
    if(candidate.text && candidate.duration > remaining) continue;
    const duration = Math.min(candidate.duration, remaining); shots.push({...candidate, duration}); remaining -= duration;
  }
  const sequence = new Map(candidates.map((c, index) => [c.id, index]));
  shots.sort((a, b) => sequence.get(a.id)! - sequence.get(b.id)!);
  return {revision: project.revision, title: topic.trim().slice(0, 120) || project.name, shots: shots.map(({id: _id, ...shot}) => shot), totalFrames: budget - remaining, warnings: [selected.some(a => !transcripts.some(t => t.assetId === a.id && t.words.length)) ? 'Some assets have no transcript; their opening shot was used.' : '', !shots.length ? 'No complete passage fits this duration. Increase the target duration.' : '', remaining > project.fps ? 'Available complete passages are shorter than the target duration.' : ''].filter(Boolean)};
}

export function captionText(clip: Clip): string {
  return clip.caption ? clip.caption.words.filter(w => w.end > clip.sourceStart && w.start < clip.sourceStart + clip.duration).map(w => w.text).join(' ') : clip.text;
}
