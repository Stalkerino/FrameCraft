import {z} from 'zod';
import type {Clip, Project} from './project';

export const minimumSpeed = .125;
export const maximumSpeed = 8;
const speedSchema = z.number().min(minimumSpeed).max(maximumSpeed);
export const speedRecipeSchema = z.object({
  speed: speedSchema.default(1),
  points: z.array(z.object({frame: z.number().int().nonnegative(), speed: speedSchema, easing: z.enum(['hold', 'linear', 'smoothstep']).default('linear')})).default([]),
  holds: z.array(z.object({frame: z.number().int().nonnegative(), duration: z.number().int().positive()})).default([]),
  audio: z.enum(['preserve', 'mute']).default('preserve'),
}).strict().superRefine((recipe, ctx) => {
  for(const key of ['points', 'holds'] as const) if(recipe[key].some((point, index) => index > 0 && point.frame <= recipe[key][index - 1].frame)) ctx.addIssue({code: 'custom', path: [key], message: 'Use distinct, increasing source frames.'});
});
export type SpeedRecipe = z.infer<typeof speedRecipeSchema>;
export const speedProcessingSchema = z.object({sourceAssetId: z.string().min(1), sourceStartSeconds: z.number().nonnegative(), sourceDurationSeconds: z.number().positive(), fps: z.number().positive(), recipe: speedRecipeSchema, outputDurationFrames: z.number().int().positive()});
export type SpeedProcessing = z.infer<typeof speedProcessingSchema>;
export const applySpeedSchema = z.object({revision: z.number().int().nonnegative(), clipId: z.string().min(1), recipe: speedRecipeSchema.optional(), targetDurationFrames: z.number().int().positive().optional()}).strict().refine(value => (value.recipe !== undefined) !== (value.targetDurationFrames !== undefined), 'Provide either a speed recipe or a target duration.');
export const resetSpeedSchema = z.object({revision: z.number().int().nonnegative(), clipId: z.string().min(1)}).strict();
export interface SpeedJob {id: string; projectId: string; status: 'queued' | 'processing' | 'done' | 'error' | 'cancelled'; progress: number; error?: string; revision?: number; clipId?: string; outputDurationFrames?: number; encoder?: string; warning?: string}
export interface SpeedContext {sourceAssetId: string; sourceStartSeconds: number; sourceDurationSeconds: number; sourceDurationFrames: number; fps: number; recipe: SpeedRecipe; outputDurationFrames: number}
interface SpeedSection {start: number; end: number; from: number; to: number}
export interface SpeedAudioSection {start: number; end: number; frames: number; hold: boolean}
const number = (value: number) => Number(value.toFixed(10)).toString();
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const boundedSpeed = (value: number) => value >= minimumSpeed - 1e-9 && value <= maximumSpeed + 1e-9 ? clamp(value, minimumSpeed, maximumSpeed) : value;
const sectionTime = (section: SpeedSection, length = section.end - section.start) => {
  const slope = (section.to - section.from) / (section.end - section.start);
  return Math.abs(slope) < 1e-10 ? length / section.from : Math.log((section.from + slope * length) / section.from) / slope;
};

/** Source-time speed curves. Linear ramps integrate exactly; smoothstep uses 128 linear sections. */
export function speedSections(input: SpeedRecipe, duration: number, fps: number): SpeedSection[] {
  const recipe = speedRecipeSchema.parse(input);
  if(!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) throw new Error('Choose a positive source duration and frame rate.');
  if(recipe.points.some(point => point.frame / fps > duration + 1e-7) || recipe.holds.some(hold => hold.frame / fps >= duration - 1e-7)) throw new Error('Speed points must fit the source; freezes must be before its end.');
  const points = recipe.points[0]?.frame === 0 ? recipe.points : [{frame: 0, speed: recipe.speed, easing: 'hold' as const}, ...recipe.points];
  const sections: SpeedSection[] = [];
  for(let index = 0; index < points.length; index++) {
    const point = points[index]; const next = points[index + 1]; const start = point.frame / fps; const end = next ? next.frame / fps : duration;
    if(end <= start) continue;
    const count = next && point.easing === 'smoothstep' ? 128 : 1;
    const value = (t: number) => !next || point.easing === 'hold' ? point.speed : point.speed + (next.speed - point.speed) * (point.easing === 'smoothstep' ? t * t * (3 - 2 * t) : t);
    for(let part = 0; part < count; part++) sections.push({start: start + (end - start) * part / count, end: start + (end - start) * (part + 1) / count, from: value(part / count), to: value((part + 1) / count)});
  }
  return sections;
}

export function speedTimeMap(recipe: SpeedRecipe, duration: number, fps: number) {
  const sections = speedSections(recipe, duration, fps);
  const motionTime = (source: number) => sections.reduce((sum, section) => sum + sectionTime(section, clamp(source - section.start, 0, section.end - section.start)), 0);
  const outputTime = (source: number, includeHoldAtPoint = false) => motionTime(source) + recipe.holds.reduce((sum, hold) => sum + (hold.frame / fps < source - 1e-9 || (includeHoldAtPoint && hold.frame / fps <= source + 1e-9) ? hold.duration / fps : 0), 0);
  const totalSeconds = outputTime(duration, true);
  return {sections, motionTime, outputTime, totalSeconds, outputFrames: Math.max(1, Math.round(totalSeconds * fps)), sourceTime(output: number) {
    let low = 0; let high = duration;
    for(let iteration = 0; iteration < 48; iteration++) {const middle = (low + high) / 2; if(outputTime(middle, true) < output) low = middle; else high = middle;}
    return clamp((low + high) / 2, 0, duration);
  }};
}

/** FFmpeg timestamp expression; gaps duplicate held frames when converted to project CFR. */
export function speedVideoFilter(recipe: SpeedRecipe, duration: number, fps: number, outputFrames?: number) {
  const map = speedTimeMap(recipe, duration, fps); const frames = outputFrames ?? map.outputFrames;
  const terms = map.sections.map(section => {
    const length = `clip(T-${number(section.start)},0,${number(section.end - section.start)})`;
    const slope = (section.to - section.from) / (section.end - section.start);
    return Math.abs(slope) < 1e-10 ? `(${length})/${number(section.from)}` : `log((${number(section.from)}+${number(slope)}*${length})/${number(section.from)})/${number(slope)}`;
  });
  terms.push(...recipe.holds.map(hold => `gt(T,${number(hold.frame / fps)})*${number(hold.duration / fps)}`));
  return `trim=duration=${number(duration)},setpts=PTS-STARTPTS,setpts='(${terms.join('+')})/TB',tpad=stop_mode=clone:stop_duration=${number(frames / fps)},fps=fps=${number(fps)}:start_time=0:round=near,trim=end_frame=${frames},setpts=N/(${number(fps)}*TB),pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p`;
}

/** Audio ramps use short, pitch-preserved tempo slices with exact cumulative output-frame lengths. */
export function speedAudioSections(recipe: SpeedRecipe, duration: number, fps: number, outputFrames?: number): SpeedAudioSection[] {
  const map = speedTimeMap(recipe, duration, fps); const totalFrames = outputFrames ?? map.outputFrames;
  const anchors = [...new Set([0, duration, ...recipe.points.map(point => point.frame / fps), ...recipe.holds.map(hold => hold.frame / fps)])].sort((a, b) => a - b);
  const boundaries = new Set<number>(anchors);
  for(let index = 0; index < anchors.length - 1; index++) {
    const start = anchors[index]; const end = anchors[index + 1];
    const varying = map.sections.some(section => section.start < end && section.end > start && Math.abs(section.to - section.from) > 1e-10);
    const beginTime = map.motionTime(start); const seconds = map.motionTime(end) - beginTime;
    const count = varying ? Math.ceil(seconds / .2) : 1;
    for(let part = 1; part < count; part++) {
      let low = start; let high = end; const target = beginTime + seconds * part / count;
      for(let step = 0; step < 32; step++) {const middle = (low + high) / 2; if(map.motionTime(middle) < target) low = middle; else high = middle;}
      boundaries.add((low + high) / 2);
    }
  }
  const times = [...boundaries].sort((a, b) => a - b); const result: SpeedAudioSection[] = [];
  for(let index = 0; index < times.length - 1; index++) {
    const start = times[index]; const end = times[index + 1]; const before = Math.round(map.outputTime(start) * fps); const afterHold = Math.round(map.outputTime(start, true) * fps);
    if(afterHold > before) result.push({start, end: start, frames: afterHold - before, hold: true});
    const endFrame = index === times.length - 2 ? totalFrames : Math.round(map.outputTime(end) * fps);
    if(endFrame > afterHold) result.push({start, end, frames: endFrame - afterHold, hold: false});
    else if(result.length && !result.at(-1)!.hold) result.at(-1)!.end = end;
  }
  return result;
}

export function tempoFilters(speed: number) {
  const factors: number[] = [];
  while(speed < .5 - 1e-9) {factors.push(.5); speed /= .5;}
  while(speed > 2 + 1e-9) {factors.push(2); speed /= 2;}
  factors.push(speed);
  return factors.map(value => `atempo=${number(value)}`).join(',');
}

export function speedRecipeForDuration(context: SpeedContext, targetFrames: number): SpeedRecipe {
  if(!Number.isInteger(targetFrames) || targetFrames < 1) throw new Error('Choose a positive target frame count.');
  const original = speedTimeMap(context.recipe, context.sourceDurationSeconds, context.fps);
  const ratio = original.totalSeconds / (targetFrames / context.fps);
  const recipe = speedRecipeSchema.parse({...context.recipe, speed: boundedSpeed(context.recipe.speed * ratio),
    points: context.recipe.points.map(point => ({...point, speed: boundedSpeed(point.speed * ratio)})),
    holds: context.recipe.holds.map(hold => ({...hold, duration: Math.max(1, Math.round(hold.duration / ratio))})),
  });
  // Integer freeze lengths can change the total by a frame: distribute the remaining time over motion.
  const heldSeconds = recipe.holds.reduce((sum, hold) => sum + hold.duration / context.fps, 0);
  const motionSeconds = targetFrames / context.fps - heldSeconds;
  if(motionSeconds <= 0) throw new Error('This duration leaves no room for the source video. Shorten the freeze holds first.');
  const adjustment = speedTimeMap(recipe, context.sourceDurationSeconds, context.fps).motionTime(context.sourceDurationSeconds) / motionSeconds;
  return speedRecipeSchema.parse({...recipe, speed: boundedSpeed(recipe.speed * adjustment), points: recipe.points.map(point => ({...point, speed: boundedSpeed(point.speed * adjustment)}))});
}

export function speedClipContext(project: Project, clip: Clip): SpeedContext {
  if(!['video', 'audio'].includes(clip.kind)) throw new Error('Select a video or audio clip to change its speed.');
  const asset = project.assets.find(item => item.id === clip.assetId);
  if(!asset) throw new Error('The source media is unavailable.');
  const metadata = asset.speedProcessing;
  if(!metadata) return {sourceAssetId: asset.id, sourceStartSeconds: clip.sourceStart / project.fps, sourceDurationSeconds: clip.duration / project.fps, sourceDurationFrames: clip.duration, fps: project.fps, recipe: speedRecipeSchema.parse({}), outputDurationFrames: clip.duration};
  if(!project.assets.some(item => item.id === metadata.sourceAssetId)) throw new Error('The original source for this speed edit is unavailable.');
  const full = clip.sourceStart === 0 && Math.abs(clip.duration / project.fps - metadata.outputDurationFrames / metadata.fps) < .5 / project.fps;
  if(full) {
    const ratio = project.fps / metadata.fps;
    const recipe = ratio === 1 ? structuredClone(metadata.recipe) : speedRecipeSchema.parse({...metadata.recipe,
      points: metadata.recipe.points.map(point => ({...point, frame: Math.min(Math.floor(metadata.sourceDurationSeconds * project.fps + 1e-7), Math.round(point.frame * ratio))})).filter((point, index, list) => index === list.length - 1 || point.frame !== list[index + 1].frame),
      holds: metadata.recipe.holds.map(hold => ({frame: Math.min(Math.ceil(metadata.sourceDurationSeconds * project.fps - 1e-7) - 1, Math.round(hold.frame * ratio)), duration: Math.max(1, Math.round(hold.duration * ratio))})).reduce<SpeedRecipe['holds']>((result, hold) => {if(result.at(-1)?.frame === hold.frame) result.at(-1)!.duration += hold.duration; else result.push(hold); return result;}, []),
    });
    return {sourceAssetId: metadata.sourceAssetId, sourceStartSeconds: metadata.sourceStartSeconds, sourceDurationSeconds: metadata.sourceDurationSeconds, sourceDurationFrames: Math.max(1, Math.floor(metadata.sourceDurationSeconds * project.fps + 1e-7)), fps: project.fps, recipe, outputDurationFrames: clip.duration};
  }
  const map = speedTimeMap(metadata.recipe, metadata.sourceDurationSeconds, metadata.fps);
  const outputStart = clip.sourceStart / project.fps; const outputEnd = (clip.sourceStart + clip.duration) / project.fps;
  // Resolve cuts on the rendered copy back to the retained source, at current project-frame precision.
  let sourceStart = Math.round(map.sourceTime(outputStart) * project.fps) / project.fps;
  let sourceEnd = Math.min(metadata.sourceDurationSeconds, Math.round(map.sourceTime(outputEnd) * project.fps) / project.fps);
  const freezes = metadata.recipe.holds.flatMap(hold => {
    const at = hold.frame / metadata.fps; const begin = map.outputTime(at); const end = begin + hold.duration / metadata.fps;
    const overlap = Math.min(end, outputEnd) - Math.max(begin, outputStart);
    return overlap > .5 / project.fps ? [{at, duration: Math.round(overlap * project.fps)}] : [];
  });
  if(sourceEnd <= sourceStart + 1e-7) {
    sourceStart = Math.min(sourceStart, metadata.sourceDurationSeconds - 1 / project.fps); sourceStart = Math.max(0, sourceStart); sourceEnd = Math.min(metadata.sourceDurationSeconds, sourceStart + 1 / project.fps);
    return {sourceAssetId: metadata.sourceAssetId, sourceStartSeconds: metadata.sourceStartSeconds + sourceStart, sourceDurationSeconds: sourceEnd - sourceStart, sourceDurationFrames: 1, fps: project.fps, recipe: speedRecipeSchema.parse({holds: clip.duration > 1 ? [{frame: 0, duration: clip.duration - 1}] : [], audio: metadata.recipe.audio}), outputDurationFrames: clip.duration};
  }
  const cropped = map.sections.filter(section => section.end > sourceStart && section.start < sourceEnd);
  const points: SpeedRecipe['points'] = [];
  for(const section of cropped) for(const at of [Math.max(sourceStart, section.start), Math.min(sourceEnd, section.end)]) {
    const frame = Math.min(Math.floor((sourceEnd - sourceStart) * project.fps + 1e-7), Math.round((at - sourceStart) * project.fps)); const speed = section.from + (section.to - section.from) * (at - section.start) / (section.end - section.start);
    const point = {frame, speed: clamp(speed, minimumSpeed, maximumSpeed), easing: Math.abs(section.to - section.from) < 1e-10 ? 'hold' as const : 'linear' as const};
    if(points.at(-1)?.frame === frame) points[points.length - 1] = point; else points.push(point);
  }
  const sourceDurationFrames = Math.max(1, Math.floor((sourceEnd - sourceStart) * project.fps + 1e-7));
  const holds = freezes.map(hold => ({frame: clamp(Math.round((hold.at - sourceStart) * project.fps), 0, sourceDurationFrames - 1), duration: hold.duration})).reduce<SpeedRecipe['holds']>((result, hold) => {if(result.at(-1)?.frame === hold.frame) result.at(-1)!.duration += hold.duration; else result.push(hold); return result;}, []);
  return {sourceAssetId: metadata.sourceAssetId, sourceStartSeconds: metadata.sourceStartSeconds + sourceStart, sourceDurationSeconds: sourceEnd - sourceStart, sourceDurationFrames, fps: project.fps, recipe: speedRecipeSchema.parse({speed: points[0]?.speed ?? 1, points, holds, audio: metadata.recipe.audio}), outputDurationFrames: clip.duration};
}
