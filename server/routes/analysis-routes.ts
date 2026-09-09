import {Router} from 'express';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {clipSchema, type Activity} from '../../shared/project';
import {transcriptWordSchema} from '../../shared/transcript';
import {captionOptionsSchema, captionsToSubtitles, createCaptions, removeTimelineRanges, transcriptRanges} from '../../shared/assisted-editing';
import type {ProjectRepository} from '../repositories/project-repository';
import type {AnalysisService} from '../services/analysis-service';

const revisionSchema = z.number().int().nonnegative();
export function analysisRoutes(service: AnalysisService, repository: ProjectRepository) {
  const router = Router();
  const recording = multer({storage: multer.memoryStorage(), limits: {fileSize: 10 * 1024 * 1024, files: 1, fields: 1}});
  router.post('/dictation', recording.single('audio'), (req, res) => {
    const language = z.enum(['auto', 'french', 'english']).parse(req.body.language || 'auto');
    if(!req.file) throw new Error('Record speech before transcribing.');
    res.status(202).json(service.dictate(req.file.buffer, language));
  });
  const source = (header: unknown): Activity['source'] => header === 'codex' ? 'codex' : 'editor';
  const projectAt = (revision: number) => {const project = repository.snapshot().project; if(project.revision !== revision) throw Object.assign(new Error('Project changed. Refresh before applying this edit.'), {status: 409}); return project;};
  router.get('/transcripts', async (_req, res) => {const documents = await service.documents(repository.snapshot().project); res.json(documents.map(({words, ...doc}) => ({...doc, wordCount: words.length})));});
  router.get('/transcripts/:id', async (req, res) => res.json(await service.transcripts.get(req.params.id)));
  router.post('/transcripts/:id', async (req, res) => {
    const body = z.object({revision: revisionSchema.nullable(), words: z.array(transcriptWordSchema).max(100000), language: z.string().max(40).default('manual')}).parse(req.body);
    const asset = repository.snapshot().project.assets.find(a => a.id === req.params.id); if(!asset || asset.kind === 'image') throw new Error('Choose a video or audio source');
    res.json(await service.transcripts.save({assetId: asset.id, revision: 0, language: body.language, words: body.words, model: 'edited', updatedAt: ''}, asset.duration, body.revision));
  });
  router.post('/transcribe', (req, res) => {const body = z.object({assetId: z.string(), language: z.enum(['auto', 'french', 'english']).default('auto'), revision: revisionSchema.nullable().default(null)}).parse(req.body); res.status(202).json(service.transcribe(repository.snapshot().project, body.assetId, body.language, body.revision));});
  router.get('/jobs', (_req, res) => res.json([...service.jobs.values()]));
  router.get('/jobs/:id', (req, res) => {const job = service.jobs.get(req.params.id); if(!job) return res.status(404).json({error: 'Analysis job not found'}); res.json(job);});
  router.post('/jobs/:id/cancel', (req, res) => res.json(service.cancel(req.params.id)));
  router.post('/search', (req, res) => {const {query} = z.object({query: z.string().trim().min(1).max(500)}).parse(req.body); res.status(202).json(service.search(repository.snapshot().project, query));});
  router.post('/cut', async (req, res) => {
    const body = z.object({revision: revisionSchema, transcriptRevision: revisionSchema, clipId: z.string(), wordIds: z.array(z.string()).min(1).max(100000), apply: z.boolean().default(false)}).parse(req.body);
    const project = projectAt(body.revision); const clip = project.clips.find(c => c.id === body.clipId);
    const doc = clip?.assetId ? await service.transcripts.get(clip.assetId) : null;
    if(!doc || doc.revision !== body.transcriptRevision) throw Object.assign(new Error('Transcript changed. Reopen it before editing.'), {status: 409});
    const ranges = transcriptRanges(project, body.clipId, doc, body.wordIds);
    if(!body.apply) return res.json({ranges, removedFrames: ranges.reduce((n, r) => n + r.end - r.start, 0), affectedClips: project.clips.filter(c => ranges.some(r => c.start + c.duration > r.start)).length});
    res.json(await repository.execute([{type: 'clips.replace', clips: removeTimelineRanges(project, ranges, randomUUID)}], body.revision, source(req.headers['x-framecraft-client']), 'Removed selected words · ripple all tracks'));
  });
  router.post('/captions', async (req, res) => {
    const body = z.object({revision: revisionSchema, transcriptRevision: revisionSchema, clipId: z.string(), options: captionOptionsSchema.default({})}).parse(req.body);
    const project = projectAt(body.revision); const clip = project.clips.find(c => c.id === body.clipId);
    const doc = clip?.assetId ? await service.transcripts.get(clip.assetId) : null;
    if(!doc || doc.revision !== body.transcriptRevision) throw Object.assign(new Error('Transcript changed. Reopen it before creating captions.'), {status: 409});
    const clips = [...project.clips.filter(c => c.caption?.parentClipId !== body.clipId), ...createCaptions(project, body.clipId, doc, body.options, randomUUID)];
    res.json(await repository.execute([{type: 'clips.replace', clips}], body.revision, source(req.headers['x-framecraft-client']), 'Generated word-timed captions'));
  });
  router.get('/subtitles/:format', (req, res) => {const format = z.enum(['srt', 'vtt']).parse(req.params.format); res.attachment(`framecraft.${format}`).type(format === 'vtt' ? 'text/vtt' : 'text/plain').send(captionsToSubtitles(repository.snapshot().project, format));});
  router.post('/roughcut', (req, res) => {
    const body = z.object({assetIds: z.array(z.string()).min(1).max(100), seconds: z.number().min(5).max(3600), topic: z.string().max(500).default('')}).parse(req.body);
    if(new Set(body.assetIds).size !== body.assetIds.length) throw new Error('Choose each source once');
    res.status(202).json(service.roughcut(repository.snapshot().project, body.assetIds, body.seconds, body.topic));
  });
  router.post('/roughcut/apply', async (req, res) => {
    const body = z.object({revision: revisionSchema, mode: z.enum(['append', 'replace']), shots: z.array(z.object({assetId: z.string(), sourceStart: z.number().int().nonnegative(), duration: z.number().int().positive()})).min(1).max(1000), title: z.string().trim().max(120).default(''), addTitle: z.boolean().default(false)}).parse(req.body);
    const project = projectAt(body.revision); const clips = body.mode === 'replace' ? [] : [...project.clips];
    let start = Math.max(0, ...clips.map(c => c.start + c.duration)); const opening = start;
    for(const shot of body.shots) {const asset = project.assets.find(a => a.id === shot.assetId); if(!asset) throw new Error('A selected source is no longer available'); clips.push(clipSchema.parse({id: randomUUID(), name: asset.name, kind: asset.kind, assetId: asset.id, track: asset.kind === 'audio' ? 'audio' : 'visual', start, duration: shot.duration, sourceStart: shot.sourceStart})); start += shot.duration;}
    if(body.addTitle && body.title) clips.push(clipSchema.parse({id: randomUUID(), name: 'Opening title', kind: 'text', track: 'text', start: opening, duration: Math.min(Math.round(project.fps * 3), start - opening), text: body.title, fontSize: 72}));
    res.json(await repository.execute([{type: 'clips.replace', clips}], body.revision, source(req.headers['x-framecraft-client']), `${body.mode === 'append' ? 'Appended' : 'Applied'} a first cut`));
  });
  return router;
}
