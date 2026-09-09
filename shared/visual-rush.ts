import {z} from 'zod';
import {clipSchema, type Command, type Project} from './project';
import {clipTrackId, projectTracks} from './tracks';

export interface VisualMetric {time: number; motion: number; brightness: number}
export interface VisualMoment {index: number; start: number; end: number; time: number; motion: number; cue: 'visual-change' | 'low-motion' | 'dark' | 'sample'}
export interface VisualReport {version: 1; id: string; assetId: string; assetName: string; duration: number; sampleInterval: number; createdAt: string; moments: VisualMoment[]; cues: {start: number; end: number; kind: 'low-motion' | 'dark' | 'visual-change'}[]}
export const analyzeVideoSchema = z.object({assetId: z.string().min(1), refresh: z.boolean().default(false)});
export const inspectVideoSchema = z.object({reportId: z.string().uuid(), page: z.number().int().min(0).optional(), time: z.number().finite().nonnegative().optional(), start: z.number().finite().nonnegative().optional(), end: z.number().finite().positive().optional()}).superRefine((value, ctx) => {
  const modes = Number(value.page !== undefined) + Number(value.time !== undefined) + Number(value.start !== undefined || value.end !== undefined);
  if(modes !== 1 || (value.start !== undefined || value.end !== undefined) && (value.start === undefined || value.end === undefined || value.end <= value.start)) ctx.addIssue({code: 'custom', message: 'Choose an overview page, a single source time, OR a source range with end after start.'});
});
export type VideoInspection = z.infer<typeof inspectVideoSchema>;
export interface VideoSheet {url: string; columns: number; frames: {index: number; time: number; timecode: string}[]; reportId: string}
/** A contact sheet is one display batch; callers can inspect as many ranges as needed. */
export function inspectionTimes(report: VisualReport, input: VideoInspection): number[] {
  if(input.time !== undefined) {if(input.time >= report.duration) throw new Error('Frame is outside the source'); return [input.time];}
  if(input.page !== undefined) {
    const times = report.moments.slice(input.page * 12, (input.page + 1) * 12).map(m => m.time);
    if(!times.length) throw new Error('This overview page is outside the report'); return times;
  }
  if(input.end! > report.duration || input.start! >= report.duration) throw new Error('Inspection range exceeds the source');
  const count = Math.min(12, Math.max(2, Math.ceil((input.end! - input.start!) * 2)));
  return Array.from({length: count}, (_, index) => input.start! + (input.end! - input.start!) * index / count);
}
export function inspectionCacheKey(input: VideoInspection) {return input.time !== undefined ? `frame-${input.time}` : input.page !== undefined ? `page-${input.page}` : `range-${input.start}-${input.end}`;}
export function cachedInspection(reportId: string, key: string): VideoInspection | null {
  const number = '(\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)';
  const range = new RegExp(`^range-${number}-${number}$`, 'i').exec(key);
  const input = key.startsWith('frame-') ? {time: Number(key.slice(6))} : key.startsWith('page-') ? {page: Number(key.slice(5))} : range ? {start: Number(range[1]), end: Number(range[2])} : {};
  const result = inspectVideoSchema.safeParse({reportId, ...input}); return result.success ? result.data : null;
}
export const visualShotSchema = z.object({id: z.string().min(1), start: z.number().finite().nonnegative(), end: z.number().finite().positive(), reason: z.string().trim().min(1), confidence: z.enum(['high', 'medium', 'low']), evidence: z.array(z.number().finite().nonnegative()).min(1).describe('All supporting source timestamps returned by inspect_video within this shot. No count limit; do not discard evidence to shorten this array.')}).refine(shot => shot.end > shot.start, 'Shot end must follow its start');
export const videoCutSchema = z.object({id: z.string().uuid(), projectId: z.string(), reportId: z.string().uuid(), assetId: z.string(), version: z.number().int().positive(), title: z.string().trim().min(1), goal: z.string(), shots: z.array(visualShotSchema).min(1), createdAt: z.string()});
export type VideoCut = z.infer<typeof videoCutSchema>;
export const saveVideoCutSchema = z.object({revision: z.number().int().nonnegative(), reportId: z.string().uuid(), id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().nullable().default(null), title: z.string().trim().min(1), goal: z.string().default(''), shots: z.array(visualShotSchema).min(1)});
export const applyVideoCutSchema = z.object({id: z.string().uuid(), version: z.number().int().positive(), revision: z.number().int().nonnegative(), mode: z.enum(['append', 'replace-track']).default('append'), trackId: z.string().optional(), shotIds: z.array(z.string()).min(1).optional()});
export const sourceTimecode = (seconds: number) => {const milliseconds = Math.round(seconds * 1000); return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;};

/** Signals guide visual inspection; none are semantic labels or automatic removal decisions. */
export function summarizeVisuals(metrics: VisualMetric[], duration: number): Pick<VisualReport, 'moments' | 'cues'> {
  if(!metrics.length) throw new Error('The video returned no frames');
  const count = Math.max(1, Math.min(48, Math.ceil(duration / 8))); const span = duration / count;
  const moments = Array.from({length: count}, (_, index): VisualMoment => {
    const start = index * span; const end = (index + 1) * span; const samples = metrics.filter(m => m.time >= start && m.time < end);
    const middle = metrics.reduce((best, m) => Math.abs(m.time - (start + end) / 2) < Math.abs(best.time - (start + end) / 2) ? m : best);
    const peak = samples.reduce((best, m) => m.motion > best.motion ? m : best, samples[0] ?? middle);
    const chosen = peak.motion > .07 ? peak : middle;
    return {index, start, end, time: chosen.time, motion: chosen.motion, cue: chosen.brightness < .035 ? 'dark' : peak.motion > .22 ? 'visual-change' : samples.length && samples.every(m => m.motion < .012) ? 'low-motion' : 'sample'};
  });
  const cues: VisualReport['cues'] = []; const step = metrics[1]?.time - metrics[0].time || .5;
  for(const kind of ['dark', 'low-motion'] as const) {
    let start: number | null = null;
    for(let i = 0; i <= metrics.length; i++) {const metric = metrics[i]; const matches = metric && (kind === 'dark' ? metric.brightness < .035 : i > 0 && metric.motion < .012);
      if(matches && start === null) start = metric.time;
      if(!matches && start !== null) {const end = Math.min(duration, metric?.time ?? metrics.at(-1)!.time + step); if(end - start >= 3) cues.push({start, end, kind}); start = null;}
    }
  }
  for(const metric of metrics.filter(m => m.motion > .22).sort((a, b) => b.motion - a.motion).slice(0, 30)) cues.push({start: Math.max(0, metric.time - step), end: Math.min(duration, metric.time + step), kind: 'visual-change'});
  return {moments, cues: cues.sort((a, b) => a.start - b.start).slice(0, 150)};
}

export function visualCutCommands(project: Project, proposal: VideoCut, input: z.infer<typeof applyVideoCutSchema>, id: () => string): Command[] {
  if(proposal.projectId !== project.id) throw new Error('This cut belongs to another project');
  if(proposal.version !== input.version) throw Object.assign(new Error('The proposal changed. Reopen it before applying.'), {status: 409});
  const asset = project.assets.find(a => a.id === proposal.assetId && a.kind === 'video'); if(!asset) throw new Error('The source video is no longer in this project');
  const target = input.trackId ? projectTracks(project).find(t => t.id === input.trackId) : projectTracks(project).find(t => t.type === 'visual');
  if(!target || target.type !== 'visual') throw new Error('Choose a video track for this cut');
  const retained = input.mode === 'replace-track' ? project.clips.filter(c => clipTrackId(project, c) !== target.id) : project.clips;
  let start = input.mode === 'replace-track' ? 0 : retained.reduce((end, c) => clipTrackId(project, c) === target.id ? Math.max(end, c.start + c.duration) : end, 0);
  const byId = new Map(proposal.shots.map(shot => [shot.id, shot]));
  const shots = input.shotIds ? input.shotIds.map(id => byId.get(id)) : proposal.shots;
  if(shots.some(shot => !shot) || new Set(shots.map(shot => shot?.id)).size !== shots.length) throw new Error('Choose distinct shots from this proposal');
  const clips = shots.map((value, index) => {
    const shot = value!;
    if(shot.end > asset.duration + .001) throw new Error('Cut exceeds the source duration');
    const sourceStart = Math.round(shot.start * project.fps); const end = Math.min(Math.floor(asset.duration * project.fps), Math.round(shot.end * project.fps));
    if(end <= sourceStart) throw new Error('A shot is shorter than one frame at this project frame rate');
    const clip = clipSchema.parse({id: id(), name: `${proposal.title.slice(0, 200)} · ${index + 1}`, kind: 'video', assetId: asset.id, track: 'visual', trackId: target.id, start, sourceStart, duration: end - sourceStart, transition: 'none'}); start += clip.duration; return clip;
  });
  // A bulk edit avoids the general command-batch cap and keeps any cut size to one undo step.
  return [{type: 'clips.replace', clips: [...retained, ...clips]}];
}
