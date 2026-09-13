import {filterFileArguments} from './filter-file-service';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {z} from 'zod';
import {reframeAudioEnvelope} from '../../shared/audio-envelope';
import {reframeVisualKeyframes} from '../../shared/visual-editing';
import {exportSettingsSchema} from '../../shared/media-settings';
import {applySpeedSchema, resetSpeedSchema, speedAudioSections, speedClipContext, speedRecipeForDuration, speedRecipeSchema, speedTimeMap, speedVideoFilter, tempoFilters, type SpeedContext, type SpeedJob, type SpeedRecipe} from '../../shared/speed-ramping';
import type {Activity, Asset, Clip, Project} from '../../shared/project';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaService} from './media-service';
import {ffmpegPath, ffprobePath, runProcess} from './process-service';
import {EncoderService} from './encoder-service';
import {hardwareEncodingArguments, type HardwareEncoder} from './encoding-arguments';

const decimal = (value: number) => Number(value.toFixed(10)).toString();
function resizedClip(clip: Clip, duration: number): Clip {
  const ratio = duration / clip.duration;
  return {...clip, duration, motionOffset: clip.motionOffset === undefined ? undefined : Math.round(clip.motionOffset * ratio),
    audioEnvelope: reframeAudioEnvelope(clip.audioEnvelope, ratio), audioDucking: reframeAudioEnvelope(clip.audioDucking, ratio),
    keyframes: clip.keyframes ? reframeVisualKeyframes(clip.keyframes, ratio) : clip.keyframes,
    zoom: clip.zoom ? {...clip.zoom, start: Math.round(clip.zoom.start * ratio), end: Math.max(Math.round(clip.zoom.start * ratio) + 1, Math.round(clip.zoom.end * ratio))} : clip.zoom,
    transitionFrames: Math.max(1, Math.min(duration, Math.round(clip.transitionFrames * ratio))),
  };
}

/** Project-owned retimed media, one bounded job at a time; original media and recipes remain editable. */
export class SpeedRampService {
  private jobs = new Map<string, SpeedJob>();
  private controllers = new Map<string, AbortController>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private projects: ProjectRepository, private media: MediaService, private files: MediaFileRepository, private cache: string, private encoders = new EncoderService()) {}
  get(id: string) {const job = this.jobs.get(id); if(!job) throw Object.assign(new Error('Speed job not found.'), {status: 404}); return structuredClone(job);}
  create(input: z.infer<typeof applySpeedSchema>, source: Activity['source']) {
    const body = applySpeedSchema.parse(input); const {project, clip, context} = this.selection(body.revision, body.clipId);
    const recipe = body.recipe ?? speedRecipeForDuration(context, body.targetDurationFrames!);
    const frames = body.targetDurationFrames ?? speedTimeMap(recipe, context.sourceDurationSeconds, project.fps).outputFrames;
    // Validate recipe endpoints before accepting a job.
    speedTimeMap(recipe, context.sourceDurationSeconds, project.fps);
    return this.enqueue(project, clip.id, frames, (job, signal) => this.process(job, project, clip, context, recipe, frames, source, signal));
  }
  reset(input: z.infer<typeof resetSpeedSchema>, source: Activity['source']) {
    const body = resetSpeedSchema.parse(input); const {project, clip, context} = this.selection(body.revision, body.clipId);
    const frames = Math.max(1, Math.round(context.sourceDurationSeconds * project.fps));
    return this.enqueue(project, clip.id, frames, async (job, signal) => {
      this.assertCurrent(project); signal.throwIfAborted(); job.status = 'processing';
      const replacement = {...resizedClip(clip, frames), assetId: context.sourceAssetId, sourceStart: Math.round(context.sourceStartSeconds * project.fps)};
      const snapshot = await this.projects.execute([{type: 'clips.replace', clips: project.clips.map(item => item.id === clip.id ? replacement : item)}], project.revision, source, 'Restored original clip speed');
      job.status = 'done'; job.progress = 1; job.revision = snapshot.project.revision;
    });
  }
  cancel(id: string) {const job = this.get(id); if(['queued', 'processing'].includes(job.status)) this.controllers.get(id)?.abort(new Error('Speed processing cancelled.')); return this.get(id);}
  close() {this.closed = true; for(const controller of this.controllers.values()) controller.abort(new Error('Editor is shutting down.'));}
  private selection(revision: number, id: string) {
    if(this.closed) throw new Error('Speed processing is shutting down.');
    const project = this.projects.snapshot().project;
    if(project.revision !== revision) throw Object.assign(new Error('The timeline changed. Select the clip again.'), {status: 409});
    const clip = project.clips.find(item => item.id === id); if(!clip) throw new Error('The clip no longer exists.');
    return {project, clip, context: speedClipContext(project, clip)};
  }
  private enqueue(project: Project, clipId: string, outputDurationFrames: number, operation: (job: SpeedJob, signal: AbortSignal) => Promise<void>) {
    const job: SpeedJob = {id: randomUUID(), projectId: project.id, status: 'queued', progress: 0, clipId, outputDurationFrames};
    const controller = new AbortController(); this.jobs.set(job.id, job); this.controllers.set(job.id, controller);
    const work = async () => {
      try {controller.signal.throwIfAborted(); await operation(job, controller.signal);}
      catch(error) {job.status = controller.signal.aborted ? 'cancelled' : 'error'; job.error = error instanceof Error ? error.message : String(error);}
      finally {this.controllers.delete(job.id);}
    };
    this.queue = this.queue.then(work, work); return structuredClone(job);
  }
  private assertCurrent(project: Project) {
    const current = this.projects.snapshot().project;
    if(current.id !== project.id || current.revision !== project.revision) throw Object.assign(new Error('The timeline changed during speed processing. No speed edit was applied; retry on the current clip.'), {status: 409});
  }
  private async process(job: SpeedJob, project: Project, clip: Clip, context: SpeedContext, recipe: SpeedRecipe, frames: number, source: Activity['source'], signal: AbortSignal) {
    this.assertCurrent(project); job.status = 'processing';
    const original = project.assets.find(asset => asset.id === context.sourceAssetId)!;
    await mkdir(this.cache, {recursive: true}); const directory = await mkdtemp(path.join(this.cache, 'speed-'));
    let imported: Asset | undefined; let committed = false;
    try {
      const sourceFile = this.files.resolve(original.src);
      const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-show_streams', '-of', 'json', sourceFile], 30_000, {signal}));
      const hasAudio = probe.streams.some((stream: {codec_type: string}) => stream.codec_type === 'audio');
      const video = path.join(directory, 'video.mp4'); const audio = path.join(directory, 'audio.wav');
      if(clip.kind === 'video') {
        const filter = path.join(directory, 'video-filter.txt');
        const graph = `[0:v:0]${speedVideoFilter(recipe, context.sourceDurationSeconds, project.fps, frames)}[v]`;
        const visual = probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'video');
        const settings = exportSettingsSchema.parse({width: Math.max(64, Math.ceil(visual.width / 2) * 2), height: Math.max(64, Math.ceil(visual.height / 2) * 2), fps: project.fps, codec: 'h264', crf: 16, preset: 'veryfast', encoder: project.exportSettings?.encoder ?? 'auto', audio: false});
        let hardware: HardwareEncoder | undefined;
        try {const selected = await this.encoders.select(settings); hardware = selected.encoder; job.encoder = selected.label; job.warning = selected.warning;}
        catch(error) {job.encoder = 'CPU'; job.warning = `GPU unavailable; using CPU for this speed edit. ${error instanceof Error ? error.message : String(error)}`;}
        const encode = async (encoder?: HardwareEncoder) => {
          signal.throwIfAborted(); const binary = encoder?.binary ?? ffmpegPath();
          let args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-ss', decimal(context.sourceStartSeconds), '-t', decimal(context.sourceDurationSeconds), '-i', sourceFile,
            '-filter_complex', graph, '-filter_complex_threads', '1', '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '2', '-frames:v', String(frames), '-video_track_timescale', '90000', '-movflags', '+faststart', '-progress', 'pipe:1', '-y', video];
          if(encoder) args = hardwareEncodingArguments(args, encoder, settings);
          const graphIndex = args.indexOf('-filter_complex'); await writeFile(filter, args[graphIndex + 1]);
          args.splice(graphIndex, 2, ...await filterFileArguments(filter, binary));
          const controller = new AbortController();
          const cancel = () => controller.abort(signal.reason); signal.addEventListener('abort', cancel, {once: true});
          let watchdog: ReturnType<typeof setTimeout>; let lastFrame = -1; let progressBuffer = '';
          const heartbeat = () => {clearTimeout(watchdog); watchdog = setTimeout(() => controller.abort(new Error('Speed encoder stopped making progress for 45 seconds.')), 45_000); watchdog.unref();};
          heartbeat();
          try {
            if(signal.aborted) cancel();
            await runProcess(binary, args, 24 * 60 * 60_000, {signal: controller.signal, onOutput(chunk) {
              progressBuffer += chunk.toString(); const lines = progressBuffer.split('\n'); progressBuffer = lines.pop()!;
              for(const line of lines) if(line.startsWith('frame=')) {
                const current = Number(line.slice(6)); if(current > lastFrame) {lastFrame = current; heartbeat();}
                job.progress = Math.min(.7, current / frames * .7);
              }
            }});
          } finally {clearTimeout(watchdog!); signal.removeEventListener('abort', cancel);}
        };
        try {await encode(hardware);}
        catch(error) {
          if(!hardware || signal.aborted) throw error;
          job.encoder = 'CPU'; job.warning = `GPU speed processing failed; using CPU for this edit. ${error instanceof Error ? error.message : String(error)}`; job.progress = 0;
          await encode();
        }
      }
      signal.throwIfAborted(); this.assertCurrent(project);
      const soundWanted = hasAudio && recipe.audio === 'preserve';
      if(soundWanted || clip.kind === 'audio') await this.renderAudio(sourceFile, context, recipe, frames, project.fps, directory, audio, soundWanted, signal, progress => {job.progress = (clip.kind === 'video' ? .7 : 0) + progress * (clip.kind === 'video' ? .25 : .95);});
      let output = clip.kind === 'video' ? video : audio;
      if(clip.kind === 'video' && soundWanted) {
        output = path.join(directory, 'output.mp4');
        await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-threads', '2', '-t', decimal(frames / project.fps), '-movflags', '+faststart', '-y', output], 600_000, {signal});
      }
      signal.throwIfAborted(); this.assertCurrent(project);
      imported = await this.media.import(output, `${clip.name.slice(0, 210)} · speed.${clip.kind === 'video' ? 'mp4' : 'wav'}`, project.id);
      imported.duration = frames / project.fps;
      imported.speedProcessing = {sourceAssetId: original.id, sourceStartSeconds: context.sourceStartSeconds, sourceDurationSeconds: context.sourceDurationSeconds, fps: project.fps, recipe: speedRecipeSchema.parse(recipe), outputDurationFrames: frames};
      const replacement = {...resizedClip(clip, frames), assetId: imported.id, sourceStart: 0};
      signal.throwIfAborted(); this.assertCurrent(project);
      const snapshot = await this.projects.execute([{type: 'asset.add', asset: imported}, {type: 'clips.replace', clips: project.clips.map(item => item.id === clip.id ? replacement : item)}], project.revision, source, 'Applied clip speed, ramps and freeze frames');
      committed = true; job.status = 'done'; job.progress = 1; job.revision = snapshot.project.revision;
    } finally {
      if(imported && !committed) await Promise.all([imported.src, imported.thumbnail, imported.previewSrc].filter((url): url is string => Boolean(url)).map(url => unlink(this.files.resolve(url)).catch(() => undefined)));
      await rm(directory, {recursive: true, force: true});
    }
  }
  private async renderAudio(source: string, context: SpeedContext, recipe: SpeedRecipe, frames: number, fps: number, directory: string, output: string, preserve: boolean, signal: AbortSignal, progress: (value: number) => void) {
    if(!preserve) {
      await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', decimal(frames / fps), '-c:a', 'pcm_s16le', '-y', output], 600_000, {signal}); progress(1); return;
    }
    const sections = speedAudioSections(recipe, context.sourceDurationSeconds, fps, frames); const files: string[] = []; let completedFrames = 0;
    // Only short audio branches share a graph. Video is already encoded separately and never buffered here.
    for(let offset = 0; offset < sections.length; offset += 32) {
      signal.throwIfAborted(); const batch = sections.slice(offset, offset + 32); const motion = batch.filter(section => !section.hold);
      const start = motion[0]?.start ?? 0; const end = motion.at(-1)?.end ?? start;
      const filters: string[] = [];
      if(motion.length) filters.push(`[0:a:0]asetpts=PTS-STARTPTS,asplit=${motion.length}${motion.map((_, index) => `[a${index}]`).join('')}`);
      let soundIndex = 0;
      for(const [index, section] of batch.entries()) {
        const samples = Math.round((completedFrames + section.frames) / fps * 48000) - Math.round(completedFrames / fps * 48000); completedFrames += section.frames;
        filters.push(section.hold ? `anullsrc=r=48000:cl=stereo,atrim=end_sample=${samples}[p${index}]`
          : `[a${soundIndex++}]atrim=start=${decimal(section.start - start)}:end=${decimal(section.end - start)},asetpts=PTS-STARTPTS,${tempoFilters((section.end - section.start) / (section.frames / fps))},aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${samples},asetpts=PTS-STARTPTS[p${index}]`);
      }
      filters.push(`${batch.map((_, index) => `[p${index}]`).join('')}concat=n=${batch.length}:v=0:a=1[a]`);
      const graph = path.join(directory, `audio-${files.length}.txt`); const file = path.join(directory, `audio-${files.length}.wav`);
      await writeFile(graph, filters.join(';'));
      await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(motion.length ? ['-threads', '1', '-ss', decimal(context.sourceStartSeconds + start), '-t', decimal(end - start), '-i', source] : []),
        ...await filterFileArguments(graph), '-filter_complex_threads', '1', '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-threads', '1', '-y', file], 600_000, {signal});
      files.push(file); progress(Math.min(1, (offset + batch.length) / sections.length));
    }
    const list = path.join(directory, 'audio-list.txt');
    // Relative generated names avoid all drive-letter, apostrophe and slash quoting issues in concat files.
    await writeFile(list, files.map(file => `file '${path.basename(file)}'`).join('\n'));
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'concat', '-safe', '1', '-i', list, '-af', `apad,atrim=end_sample=${Math.round(frames / fps * 48000)}`, '-c:a', 'pcm_s16le', '-threads', '1', '-y', output], 600_000, {signal});
  }
}
