import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {normalizeWords, transcriptSegments, type AnalysisJob, type SearchHit, type Transcript} from '../../shared/transcript';
import {proposeRoughCut} from '../../shared/assisted-editing';
import type {Project} from '../../shared/project';
import {TranscriptRepository} from '../repositories/transcript-repository';
import {type InferenceProvider, type Progress, withExtractedAudio} from './inference-service';
import {VisualRushService} from './visual-rush-service';
import {MediaFileRepository} from '../repositories/media-file-repository';

export class AnalysisService {
  readonly jobs = new Map<string, AnalysisJob>();
  private controllers = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly visual: VisualRushService;
  constructor(readonly transcripts: TranscriptRepository, private inference: InferenceProvider, private options: {data: string; media: string; cache: string}) {this.visual = new VisualRushService(options);}
  analyzeVideo(project: Project, assetId: string, refresh: boolean) {
    if(!project.assets.some(a => a.id === assetId && a.kind === 'video')) throw new Error('Choose a video');
    return this.enqueue('visual-scan', async (job, signal, progress) => {job.reportId = (await this.visual.scan(project, assetId, refresh, signal, progress)).id;}, assetId);
  }
  private enqueue(kind: AnalysisJob['kind'], task: (job: AnalysisJob, signal: AbortSignal, progress: Progress) => Promise<void>, assetId?: string) {
    if(this.controllers.size >= 8) throw new Error('Eight analyses are already queued. Wait or cancel one.');
    const job: AnalysisJob = {id: randomUUID(), kind, assetId, status: 'queued', progress: 0, message: 'Waiting for local analysis'};
    const controller = new AbortController(); this.controllers.set(job.id, controller); this.jobs.set(job.id, job);
    for(const [id, old] of this.jobs) if(this.jobs.size > 50 && ['done', 'error', 'cancelled'].includes(old.status)) this.jobs.delete(id);
    const run = this.queue.then(async () => {
      if(controller.signal.aborted) return;
      job.status = 'running';
      try {
        await mkdir(this.options.cache, {recursive: true});
        await task(job, controller.signal, (progress, message) => {job.progress = Math.max(job.progress, Math.min(.99, progress)); job.message = message;});
        if(!controller.signal.aborted) {job.status = 'done'; job.progress = 1; job.message = 'Ready';}
      } catch(error) {if(!controller.signal.aborted) {job.status = 'error'; job.error = (error as Error).message; job.message = job.error;}}
      finally {this.controllers.delete(job.id);}
    });
    this.queue = run.catch(() => undefined); return structuredClone(job);
  }
  cancel(id: string) {
    const job = this.jobs.get(id); if(!job) throw new Error('Analysis job not found');
    if(['queued', 'running'].includes(job.status)) {job.status = 'cancelled'; job.message = 'Cancelled'; this.controllers.get(id)?.abort(); this.controllers.delete(id);}
    return job;
  }
  close() {for(const id of this.controllers.keys()) this.cancel(id);}
  dictate(recording: Buffer, language: 'auto' | 'french' | 'english') {
    if(!recording.length || recording.length > 10 * 1024 * 1024) throw new Error('Record up to two minutes of speech (10 MB maximum).');
    return this.enqueue('dictation', async (job, signal, progress) => {
      const temporaryRoot = path.join(this.options.data, 'analysis-temp'); await mkdir(temporaryRoot, {recursive: true});
      const directory = await mkdtemp(path.join(temporaryRoot, 'dictation-'));
      try {
        const file = path.join(directory, 'recording'); await writeFile(file, recording); signal.throwIfAborted();
        const result = await withExtractedAudio(file, directory, signal, audio => this.inference.run({kind: 'transcription', file: audio, language, cacheDir: this.options.cache}, signal, progress), 120);
        signal.throwIfAborted(); job.text = (result.chunks ?? []).map(c => c.text.trim()).filter(Boolean).join(' ').slice(0, 16000);
        if(!job.text) throw new Error('No speech detected. Try recording again closer to the microphone.');
      } finally {await rm(directory, {recursive: true, force: true});}
    });
  }
  transcribe(project: Project, assetId: string, language: 'auto' | 'french' | 'english', expectedRevision: number | null) {
    const asset = project.assets.find(a => a.id === assetId);
    if(!asset || !['video', 'audio'].includes(asset.kind)) throw new Error('Choose an imported video or audio source');
    if(asset.duration > 7200) throw new Error('Transcribe sources up to two hours long.');
    const file = new MediaFileRepository(this.options.media).resolve(asset.src);
    if([...this.jobs.values()].some(j => j.assetId === assetId && ['queued', 'running'].includes(j.status))) throw new Error('This source is already being transcribed');
    return this.enqueue('transcription', async (_job, signal, progress) => {
      progress(.02, 'Extracting audio');
      await mkdir(path.join(this.options.data, 'analysis-temp'), {recursive: true});
      const result = await withExtractedAudio(file, path.join(this.options.data, 'analysis-temp'), signal, audio => this.inference.run({kind: 'transcription', file: audio, language, cacheDir: this.options.cache}, signal, progress));
      signal.throwIfAborted();
      const words = normalizeWords(result.chunks ?? [], asset.duration, randomUUID);
      if(!words.length) throw new Error('No speech was found in this source.');
      await this.transcripts.save({assetId, revision: 0, language, model: result.model, updatedAt: '', words}, asset.duration, expectedRevision);
    }, assetId);
  }
  async documents(project: Project) {return (await Promise.all(project.assets.map(a => this.transcripts.get(a.id)))).filter((t): t is Transcript => t !== null);}
  search(project: Project, query: string) {
    return this.enqueue('search', async (job, signal, progress) => {job.results = await this.rank(project, query, signal, progress);});
  }
  roughcut(project: Project, assetIds: string[], seconds: number, topic: string) {
    return this.enqueue('roughcut', async (job, signal, progress) => {
      const documents = await this.documents(project);
      const hits = topic.trim() ? await this.rank({...project, assets: project.assets.filter(a => assetIds.includes(a.id))}, topic, signal, progress) : [];
      job.proposal = proposeRoughCut(project, documents, assetIds, seconds, topic, hits.map(h => h.match === 'transcript' ? `${h.assetId}:${h.id}` : h.assetId));
    });
  }
  private async rank(project: Project, query: string, signal: AbortSignal, progress: Progress): Promise<SearchHit[]> {
    const documents = await this.documents(project);
    const segments: SearchHit[] = project.assets.flatMap<SearchHit>(asset => {
      const transcript = documents.find(t => t.assetId === asset.id);
      return transcript?.words.length ? transcriptSegments(transcript).map(s => ({...s, assetName: asset.name, score: 0, match: 'transcript' as const})) : [{id: asset.id, assetId: asset.id, assetName: asset.name, text: asset.name, start: 0, end: Math.min(asset.duration, 6), wordIds: [], score: 0, match: 'filename' as const}];
    });
    if(!segments.length) return [];
    if(segments.length > 20000) throw new Error('Search supports up to 20,000 passages per project.');
    const cacheFile = path.join(this.options.cache, 'speech-embeddings-v1.json');
    let cache: Record<string, number[]> = {};
    try {cache = JSON.parse(await readFile(cacheFile, 'utf8'));} catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') cache = {};}
    const key = (text: string) => createHash('sha256').update(text).digest('hex');
    const missing = [...new Set(segments.map(s => s.text))].filter(text => !Array.isArray(cache[key(text)]));
    const result = await this.inference.run({kind: 'embedding', texts: [query, ...missing], cacheDir: this.options.cache}, signal, progress);
    const [queryVector, ...vectors] = result.vectors ?? [];
    if(!queryVector || vectors.length !== missing.length) throw new Error('The local model returned an incomplete search index');
    missing.forEach((text, i) => {cache[key(text)] = vectors[i];});
    // Keep only current project passages; corrections invalidate their old text hash.
    cache = Object.fromEntries(segments.map(s => [key(s.text), cache[key(s.text)]]));
    signal.throwIfAborted();
    const temporary = `${cacheFile}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(cache)); await rename(temporary, cacheFile);
    return segments.map(segment => ({...segment, score: cache[key(segment.text)].reduce((sum, value, i) => sum + value * (queryVector[i] ?? 0), 0)})).sort((a, b) => b.score - a.score).slice(0, 50);
  }
}
