import express from 'express';
import {createEventStream} from './http/event-stream';
import {isConnectionError} from './http/connection-errors';
import multer from 'multer';
import {mkdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {commandSchema} from '../shared/project';
import {codecNames, exportSettingsSchema} from '../shared/media-settings';
import {demoArtwork} from '../shared/demo';
import {baseUrl, dataDir, exportDir, host, libraryDir, mediaDir, port, rootDir, thumbnailDir} from './config';
import {ProjectRepository} from './repositories/project-repository';
import {MediaService} from './services/media-service';
import {RenderService} from './services/render-service';
import {EncoderService} from './services/encoder-service';
import {AgentConnectionService} from './services/agent-connection-service';
import {CodexSessionService} from './services/codex-session-service';
import {agentRoutes} from './routes/agent-routes';
import {serverOrigins} from './services/network-service';
import {TranscriptRepository} from './repositories/transcript-repository';
import {LocalInferenceProvider} from './services/inference-service';
import {AnalysisService} from './services/analysis-service';
import {analysisRoutes} from './routes/analysis-routes';
import {PresetRepository} from './repositories/preset-repository';
import {PresetService} from './services/preset-service';
import {presetRoutes} from './routes/preset-routes';
import {projectRoutes} from './routes/project-routes';
import {visualRushRoutes} from './routes/visual-rush-routes';
import {MediaFileRepository} from './repositories/media-file-repository';
import {MediaPreviewService} from './services/media-preview-service';
import {mediaPreviewRoutes, projectMediaRoutes} from './routes/media-routes';
import {TimelineService} from './services/timeline-service';
import {timelineRoutes} from './routes/timeline-routes';
import {AudioEffectsService} from './services/audio-effects-service';
import {audioEffectsRoutes} from './routes/audio-effects-routes';
import {AudioMixService} from './services/audio-mix-service';
import {audioMixRoutes} from './routes/audio-mix-routes';
import {SoundLibraryService} from './services/sound-library-service';
import {soundRoutes} from './routes/sound-routes';
import {ColorGradingService} from './services/color-grading-service';
import {colorGradingRoutes} from './routes/color-grading-routes';
import {SpeedRampService} from './services/speed-ramp-service';
import {speedRampRoutes} from './routes/speed-ramp-routes';
import {TimelineExportService} from './services/timeline-export-service';
import {timelineExportRoutes} from './routes/timeline-export-routes';

export async function createApp() {
  const app = express();
  const repository = new ProjectRepository(dataDir); await repository.init();
  await Promise.all([mediaDir, exportDir, thumbnailDir, path.join(dataDir, 'uploads')].map(dir => mkdir(dir, {recursive: true})));
  await Promise.all(['world', 'build', 'detail'].map((name, i) => writeFile(path.join(mediaDir, `demo-${name}.svg`), demoArtwork(i))));
  const mediaFiles = new MediaFileRepository(mediaDir);
  const media = new MediaService(mediaFiles); const previews = new MediaPreviewService(mediaFiles); const renders = new RenderService();
  const encoders = new EncoderService();
  previews.ensure(repository.snapshot().project.assets);
  repository.on('change', snapshot => previews.ensure(snapshot.project.assets));
  const presetRepository = new PresetRepository(libraryDir); await presetRepository.init();
  const presets = new PresetService(presetRepository, repository, renders);
  const timeline = new TimelineService(repository);
  const timelineExports = new TimelineExportService(repository, mediaFiles, exportDir);
  const grading = new ColorGradingService(repository);
  const audioEffects = new AudioEffectsService(repository, media, mediaFiles, path.join(dataDir, 'audio-cache'));
  const speedRamps = new SpeedRampService(repository, media, mediaFiles, path.join(dataDir, 'speed-cache'), encoders);
  const audioMix = new AudioMixService(repository);
  const sounds = new SoundLibraryService(libraryDir, media, repository); await sounds.init();
  const agents = new AgentConnectionService();
  const codex = new CodexSessionService({root: rootDir, data: dataDir, url: baseUrl});
  const analysis = new AnalysisService(new TranscriptRepository(path.join(dataDir, 'transcripts')), new LocalInferenceProvider(rootDir), {data: dataDir, media: mediaDir, cache: path.resolve(process.env.FRAMECRAFT_MODEL_CACHE || path.join(rootDir, '.cache', 'models'))});
  let agentLastSeen: string | null = null;
  let editorContext = {frame: 0, selectedId: null as string | null, selectedTrackId: null as string | null};
  let contextProjectId = repository.snapshot().project.id;
  repository.on('change', snapshot => {if(snapshot.project.id !== contextProjectId) {contextProjectId = snapshot.project.id; editorContext = {frame: 0, selectedId: null, selectedTrackId: null};}});
  const allowedOrigins = serverOrigins(host, port);
  const allowedHosts = new Set([...allowedOrigins].map(origin => new URL(origin).host));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if(!allowedHosts.has((req.headers.host || '').toLowerCase())) return res.status(403).json({error: 'Untrusted host'});
    const origin = req.headers.origin;
    if(origin && !allowedOrigins.has(origin)) return res.status(403).json({error: 'Untrusted origin'});
    if(req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json') && !req.is('multipart/form-data')) return res.status(415).json({error: 'Use JSON or multipart form data'});
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if(req.headers['x-framecraft-client'] === 'codex') agentLastSeen = new Date().toISOString();
    next();
  });
  // Cut data may contain any number of reviewed shots and evidence timestamps.
  app.use(['/api/visual-rush/cuts', '/api/visual-rush/apply'], express.json({limit: Infinity}));
  app.use(express.json({limit: '4mb'}));
  app.use('/api/agent/chat', agentRoutes(codex));
  app.use('/api/analysis', analysisRoutes(analysis, repository));
  app.use('/api/visual-rush', visualRushRoutes(analysis, repository));
  app.use('/visual-rush/images', express.static(path.join(dataDir, 'visual-rush', 'images'), {dotfiles: 'deny'}));
  app.use('/api/asset-presets', presetRoutes(presets));
  app.use('/api/timeline', timelineRoutes(timeline));
  app.use('/api/timeline-export', timelineExportRoutes(timelineExports));
  app.use('/api/color-grading', colorGradingRoutes(grading));
  app.use('/api/audio', audioMixRoutes(audioMix));
  app.use('/api/audio-effects', audioEffectsRoutes(audioEffects));
  app.use('/api/speed', speedRampRoutes(speedRamps));
  app.use('/api/sounds', soundRoutes(sounds));
  app.use('/api/projects', projectRoutes(repository, () => ['working', 'starting'].includes(codex.snapshot().status)));
  app.use('/api/media', mediaPreviewRoutes(previews, repository));
  app.use('/project-media', projectMediaRoutes(mediaFiles));
  app.use('/media', express.static(mediaDir, {dotfiles: 'deny'}));
  app.use('/thumbnails', express.static(thumbnailDir));
  app.use('/exports', express.static(exportDir));
  app.get('/api/project', (_req, res) => res.json(repository.snapshot()));
  app.get('/api/status', (_req, res) => res.json({agentLastSeen, agentConnections: agents.active(), editorContext, platform: process.platform, projectPath: path.join(dataDir, 'project.json'), rootDir}));
  app.post('/api/agent/presence', (req, res) => {
    const {id, clientName, state} = z.object({id: z.string().uuid(), clientName: z.string().min(1).max(120), state: z.enum(['connected', 'disconnected'])}).parse(req.body);
    if(state === 'connected') agents.heartbeat(id, clientName); else agents.disconnect(id);
    res.json({ok: true});
  });
  app.post('/api/context', (req, res) => {
    const {projectId, ...context} = z.object({projectId: z.string().optional(), frame: z.number().int().nonnegative(), selectedId: z.string().nullable(), selectedTrackId: z.string().nullable().default(null)}).parse(req.body);
    if(projectId && projectId !== repository.snapshot().project.id) return res.status(409).json({error: 'Editor context belongs to another project'});
    editorContext = context; res.json({ok: true});
  });
  app.get('/api/events', (req, res, next) => {
    const stream = createEventStream(req, res, next);
    const send = (snapshot: unknown) => stream.send(snapshot);
    const sendAgent = (snapshot: unknown) => stream.send(snapshot, 'agent');
    const sendPresets = (snapshot: {revision: number}) => stream.send({revision: snapshot.revision}, 'presets');
    const sendSounds = (snapshot: {revision: number}) => stream.send({revision: snapshot.revision}, 'sounds');
    const sendMedia = () => stream.send(previews.snapshot(repository.snapshot().project.assets), 'media');
    stream.subscribe(repository, send); stream.subscribe(codex, sendAgent);
    stream.subscribe(presetRepository, sendPresets); stream.subscribe(sounds.library, sendSounds);
    stream.subscribe(previews, sendMedia); stream.subscribe(repository, sendMedia);
    send(repository.snapshot()); sendAgent(codex.snapshot());
    sendPresets(presetRepository.snapshot()); sendSounds(sounds.library.snapshot()); sendMedia();
  });
  app.post('/api/commands', async (req, res) => {
    const body = z.object({commands: z.array(commandSchema), revision: z.number().int(), label: z.string().max(180).default('Updated the timeline')}).parse(req.body);
    res.json(await repository.execute(body.commands, body.revision, req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor', body.label));
  });
  app.post('/api/history/:direction', async (req, res) => {
    const direction = z.enum(['undo', 'redo']).parse(req.params.direction);
    const {revision} = z.object({revision: z.number().int()}).parse(req.body);
    res.json(await repository.history(direction, revision, req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor'));
  });
  const upload = multer({dest: path.join(dataDir, 'uploads'), limits: {fileSize: 2 * 1024 ** 3, files: 1}});
  app.post('/api/import', (req, res, next) => {res.locals.projectId = z.string().min(1).parse(req.query.projectId ?? repository.snapshot().project.id); next();}, upload.single('file'), async (req, res) => {
    if(!req.file) throw new Error('Choose a media file');
    try {
      const asset = await media.import(req.file.path, req.file.originalname, res.locals.projectId, true);
      res.json(await repository.addImportedAsset(asset, res.locals.projectId, 'editor'));
      previews.ensure([asset]);
    } finally {await unlink(req.file.path).catch(() => undefined);}
  });
  app.post('/api/import-path', async (req, res) => {
    const {filePath} = z.object({filePath: z.string().min(1)}).parse(req.body);
    if(!path.isAbsolute(filePath)) throw new Error('Use an absolute file path');
    const projectId = repository.snapshot().project.id;
    const asset = await media.import(filePath, path.basename(filePath), projectId);
    res.json(await repository.addImportedAsset(asset, projectId, 'codex'));
    previews.ensure([asset]);
  });
  app.get('/api/render/encoders', async (req, res) => {res.json(await encoders.capabilities(z.enum(codecNames).default('h264').parse(req.query.codec)));});
  app.post('/api/render', (req, res) => {
    const body = z.object({kind: z.enum(['video', 'frame']), frame: z.number().int().optional(), settings: exportSettingsSchema.optional(), revision: z.number().int().optional()}).parse(req.body);
    const project = repository.snapshot().project;
    if(body.revision !== undefined && body.revision !== project.revision) throw Object.assign(new Error('Project changed. Reopen export settings before exporting.'), {status: 409});
    res.status(202).json(renders.create(project, body.kind, body.frame, body.settings));
  });
  app.get('/api/render/:id', (req, res) => {const job = renders.jobs.get(req.params.id); if(!job) return res.status(404).json({error: 'Render job not found'}); res.json(job);});
  app.get('/api/project/download', (_req, res) => res.attachment('framecraft-project.json').json(repository.snapshot().project));
  app.use(express.static(path.join(rootDir, 'dist')));
  app.use((error: Error & {status?: number; code?: string}, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if(isConnectionError(error)) {res.destroy(); return;}
    if(req.aborted || res.destroyed) return;
    if(res.headersSent) {next(error); return;}
    console.error(error.message); res.status(error.status || 400).json({error: error.message});
  });
  return {app, repository, renders, codex, analysis, presets, previews, audioEffects, speedRamps, sounds};
}
