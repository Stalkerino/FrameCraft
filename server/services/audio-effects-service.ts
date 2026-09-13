import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import type {z} from 'zod';
import {applyAudioEffectsSchema, audioEffectFilters, type AudioEffectJob} from '../../shared/audio-effects';
import {clipSchema, type Activity, type Asset, type Clip, type Command, type Project} from '../../shared/project';
import {projectTracks} from '../../shared/tracks';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaService} from './media-service';
import {ffmpegPath, runProcess} from './process-service';

/** One bounded FFmpeg audio task at a time; completed copies use normal media playback/export. */
export class AudioEffectsService {
  private jobs = new Map<string, AudioEffectJob>();
  private controllers = new Map<string, AbortController>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private projects: ProjectRepository, private media: MediaService, private files: MediaFileRepository, private cache: string) {}
  get(id: string) {const job = this.jobs.get(id); if(!job) throw Object.assign(new Error('Audio effect job not found.'), {status: 404}); return structuredClone(job);}
  create(input: z.infer<typeof applyAudioEffectsSchema>, source: Activity['source']) {
    if(this.closed) throw new Error('Audio processing is shutting down.');
    const body = applyAudioEffectsSchema.parse(input); const project = this.projects.snapshot().project;
    if(project.revision !== body.revision) throw Object.assign(new Error('Project changed. Select the clips again.'), {status: 409});
    if(new Set(body.clipIds).size !== body.clipIds.length) throw new Error('Choose each audio/video clip once.');
    const clips = body.clipIds.map(id => {
      const clip = project.clips.find(item => item.id === id);
      if(!clip || !['audio', 'video'].includes(clip.kind)) throw new Error('Select audio or video clips to process.');
      return clip;
    });
    const job: AudioEffectJob = {id: randomUUID(), projectId: project.id, status: 'queued', progress: 0};
    const controller = new AbortController(); this.jobs.set(job.id, job); this.controllers.set(job.id, controller);
    const work = async () => {
      try {controller.signal.throwIfAborted(); await this.process(job, project, clips, body, source, controller.signal);}
      catch(error) {job.status = controller.signal.aborted ? 'cancelled' : 'error'; job.error = error instanceof Error ? error.message : String(error);}
      finally {this.controllers.delete(job.id);}
    };
    this.queue = this.queue.then(work, work);
    return structuredClone(job);
  }
  cancel(id: string) {const job = this.get(id); if(['queued', 'processing'].includes(job.status)) this.controllers.get(id)?.abort(new Error('Audio processing cancelled.')); return this.get(id);}
  close() {this.closed = true; for(const controller of this.controllers.values()) controller.abort(new Error('Editor is shutting down.'));}
  private assertCurrent(project: Project) {
    const current = this.projects.snapshot().project;
    if(current.id !== project.id || current.revision !== project.revision) throw Object.assign(new Error('The timeline changed while processing audio. No audio edit was applied; retry on the current clips.'), {status: 409});
  }
  private async process(job: AudioEffectJob, project: Project, clips: Clip[], body: z.infer<typeof applyAudioEffectsSchema>, source: Activity['source'], signal: AbortSignal) {
    this.assertCurrent(project); job.status = 'processing';
    await mkdir(this.cache, {recursive: true}); const directory = await mkdtemp(path.join(this.cache, 'effects-'));
    const assets: Asset[] = []; const processed: Clip[] = []; const commands: Command[] = [];
    let track = projectTracks(project).find(item => item.type === 'audio');
    if(clips.some(clip => clip.kind === 'video') && !track) {
      track = {id: `audio-${randomUUID()}`, name: 'Processed audio', type: 'audio', hidden: false, muted: false};
      commands.push({type: 'track.add', track});
    }
    try {
      for(const [index, clip] of clips.entries()) {
        signal.throwIfAborted();
        const asset = project.assets.find(item => item.id === clip.assetId);
        if(!asset) throw new Error('Audio source is unavailable.');
        // Reapplying settings starts from the retained original, avoiding cumulative processing.
        const original = asset.audioProcessing ? project.assets.find(item => item.id === asset.audioProcessing!.sourceAssetId) : asset;
        if(!original) throw new Error('The original source for this processed audio is unavailable.');
        const sourceStart = (asset.audioProcessing?.sourceStartSeconds ?? 0) + clip.sourceStart / project.fps;
        const seconds = clip.duration / project.fps; const output = path.join(directory, `${index}.wav`);
        const filter = `${audioEffectFilters(body.effects)},apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS`;
        await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-ss', String(sourceStart), '-t', String(seconds), '-i', this.files.resolve(original.src), '-map', '0:a:0', '-vn', '-af', filter, '-filter_threads', '1', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-threads', '1', '-y', output], 600_000, {signal});
        signal.throwIfAborted();
        const imported = await this.media.import(output, `${clip.name.slice(0, 200)} · processed.wav`, project.id);
        imported.audioProcessing = {sourceAssetId: original.id, sourceStartSeconds: sourceStart, effects: body.effects};
        assets.push(imported);
        processed.push(clip.kind === 'audio' ? {...clip, assetId: imported.id, sourceStart: 0} : clipSchema.parse({
          id: randomUUID(), name: `${clip.name.slice(0, 210)} · processed audio`, kind: 'audio', assetId: imported.id,
          track: 'audio', trackId: track!.id, start: clip.start, duration: clip.duration, sourceStart: 0,
          linkId: clip.linkId || randomUUID(), groupId: clip.groupId,
          volume: clip.volume, audioEnvelope: clip.audioEnvelope, audioDucking: clip.audioDucking,
        }));
        job.progress = (index + 1) / clips.length * .95;
      }
      signal.throwIfAborted(); this.assertCurrent(project);
      commands.push(...assets.map(asset => ({type: 'asset.add' as const, asset})));
      const replacements = new Map(clips.map((clip, index) => [clip.id, processed[index]]));
      commands.push({type: 'clips.replace', clips: [...project.clips.map(clip => replacements.has(clip.id)
        ? clip.kind === 'video' ? {...clip, volume: 0, audioEnvelope: undefined, audioDucking: undefined, linkId: replacements.get(clip.id)!.linkId} : replacements.get(clip.id)!
        : clip), ...processed.filter((_, index) => clips[index].kind === 'video')]});
      const snapshot = await this.projects.execute(commands, project.revision, source, 'Applied audio EQ, dynamics and room effects');
      job.status = 'done'; job.progress = 1; job.revision = snapshot.project.revision; job.clipIds = processed.map(clip => clip.id);
    } finally {await rm(directory, {recursive: true, force: true});}
  }
}
