import {AutoAudioService} from './services/auto-audio-service';
import {AudioActivityService} from './services/audio-activity-service';
import {autoAudioRoutes} from './routes/auto-audio-routes';
import {AudioRenderService} from './services/audio-render-service';
import {ColorScopeService} from './services/color-scope-service';
import {ColorLibraryService} from './services/color-library-service';
import {activeSequenceId, timelineIdentity} from '../shared/project-sequences';
import express from 'express';
import {createEventStream} from './http/event-stream';
import {isConnectionError} from './http/connection-errors';
import multer from 'multer';
import {mkdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {commandSchema, type Snapshot} from '../shared/project';
import {demoArtwork} from '../shared/demo';
import {baseUrl, dataDir, exportDir, host, libraryDir, mediaDir, port, rootDir, thumbnailDir} from './config';
import {ProjectRepository} from './repositories/project-repository';
import {MediaService} from './services/media-service';
import {RenderService} from './services/render-service';
import {EncoderService} from './services/encoder-service';
import {AgentConnectionService} from './services/agent-connection-service';
import {AgentSessionService} from './services/agent-session-service';
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
import {renderRoutes} from './routes/render-routes';
import {NativePreviewService} from './services/native-preview-service';
import {WaveformService} from './services/waveform-service';
import {waveformRoutes} from './routes/waveform-routes';
import {ProjectMediaService} from './services/project-media-service';
import {ProjectTransferService} from './services/project-transfer-service';
import {projectCareRoutes} from './routes/project-care-routes';

export async function createApp() {
  const app = express();
  const repository = new ProjectRepository(dataDir); await repository.init();
  await Promise.all([mediaDir, exportDir, thumbnailDir, path.join(dataDir, 'uploads')].map(dir => mkdir(dir, {recursive: true})));
  await Promise.all(['world', 'build', 'detail'].map((name, i) => writeFile(path.join(mediaDir, `demo-${name}.svg`), demoArtwork(i))));
  const mediaFiles = new MediaFileRepository(mediaDir);
  const media = new MediaService(mediaFiles); const previews = new MediaPreviewService(mediaFiles); const renders = new RenderService();
  const projectMedia = new ProjectMediaService(repository, mediaFiles, media);
  const transfers = new ProjectTransferService(repository, mediaFiles);
  const encoders = new EncoderService();
  const waveforms = new WaveformService(mediaFiles, path.join(dataDir, 'waveforms'));
  previews.ensure(repository.snapshot().project.assets);
  let knownMedia = new Set(repository.snapshot().project.assets.map(asset => `${asset.id}:${asset.src}`));
  repository.on('change', (snapshot: Snapshot) => {
    previews.ensure(snapshot.project.assets);
    previews.prepare(snapshot.project.assets.filter(asset => !knownMedia.has(`${asset.id}:${asset.src}`)));
    knownMedia = new Set(snapshot.project.assets.map(asset => `${asset.id}:${asset.src}`));
  });
  const presetRepository = new PresetRepository(libraryDir); await presetRepository.init();
  const presets = new PresetService(presetRepository, repository, renders);
  const timeline = new TimelineService(repository);
  const timelineExports = new TimelineExportService(repository, mediaFiles, exportDir);
  const grading = new ColorGradingService(repository);
  const audioEffects = new AudioEffectsService(repository, media, mediaFiles, path.join(dataDir, 'audio-cache'));
  const speedRamps = new SpeedRampService(repository, media, mediaFiles, path.join(dataDir, 'speed-cache'), encoders);
  const audioRenderer=new AudioRenderService(mediaFiles,path.join(dataDir,'audio-mixes'));
  const audioMix = new AudioMixService(repository,audioRenderer);
  const sounds = new SoundLibraryService(libraryDir, media, repository); await sounds.init();
  const autoAudio=new AutoAudioService(repository,audioRenderer,new AudioActivityService(path.join(dataDir,'audio-activity')),sounds,path.join(dataDir,'auto-audio'));
  const agents = new AgentConnectionService();
  const codex = new AgentSessionService({root: rootDir, data: dataDir, url: baseUrl}); await codex.init();
  const analysis = new AnalysisService(new TranscriptRepository(path.join(dataDir, 'transcripts')), new LocalInferenceProvider(rootDir), {data: dataDir, media: mediaDir, cache: path.resolve(process.env.FRAMECRAFT_MODEL_CACHE || path.join(rootDir, '.cache', 'models'))});
  let agentLastSeen: string | null = null;
  let editorContext = {frame: 0, selectedId: null as string | null, selectedTrackId: null as string | null};
  let contextProjectId = timelineIdentity(repository.snapshot().project);
  repository.on('change', snapshot => {if(timelineIdentity(snapshot.project) !== contextProjectId) {contextProjectId = timelineIdentity(snapshot.project); editorContext = {frame: 0, selectedId: null, selectedTrackId: null};}});
  const allowedOrigins = serverOrigins(host, port);
  const allowedHosts = new Set([...allowedOrigins].map(origin => new URL(origin).host));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if(!allowedHosts.has((req.headers.host || '').toLowerCase())) return res.status(403).json({error: 'Untrusted host'});
    const origin = req.headers.origin;
    const renderMedia = !!origin && (req.method === 'GET' || req.method === 'HEAD') && renders.mediaAccess.permits(req.path, req.query['framecraft-render'], origin);
    if(origin && !allowedOrigins.has(origin) && !renderMedia) return res.status(403).json({error: 'Untrusted origin'});
    if(renderMedia) {res.setHeader('Access-Control-Allow-Origin', origin!); res.vary('Origin');}
    if(req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json') && !req.is('multipart/form-data')) return res.status(415).json({error: 'Use JSON or multipart form data'});
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if(req.headers['x-framecraft-client'] === 'codex') agentLastSeen = new Date().toISOString();
    next();
  });
  // Cut data may contain any number of reviewed shots and evidence timestamps.
  app.use(['/api/visual-rush/cuts', '/api/visual-rush/apply'], express.json({limit: Infinity}));
  app.use('/api/color-grading/luts/import', express.json({limit: '21mb'}));
  app.use(express.json({limit: '4mb'}));
  app.use('/api/agent/chat', agentRoutes(codex));
  app.use('/api/analysis', analysisRoutes(analysis, repository));
  app.use('/api/visual-rush', visualRushRoutes(analysis, repository));
  app.use('/visual-rush/images', express.static(path.join(dataDir, 'visual-rush', 'images'), {dotfiles: 'deny'}));
  app.use('/api/asset-presets', presetRoutes(presets));
  app.use('/api/timeline', timelineRoutes(timeline));
  app.use('/api/timeline-export', timelineExportRoutes(timelineExports));
  app.use('/api/color-grading', colorGradingRoutes(grading, new ColorLibraryService(path.join(libraryDir, 'color-luts'), repository), new ColorScopeService(repository, renders)));
  app.use('/api/audio', audioMixRoutes(audioMix));
  app.use('/api/auto-audio',autoAudioRoutes(autoAudio));
  app.use('/api/audio-effects', audioEffectsRoutes(audioEffects));
  app.use('/api/speed', speedRampRoutes(speedRamps));
  app.use('/api/sounds', soundRoutes(sounds));
  app.use('/api/projects', projectRoutes(repository, () => ['working', 'starting'].includes(codex.snapshot().status)));
  app.use('/api/project-care', projectCareRoutes(repository, projectMedia, transfers, () => ['working', 'starting'].includes(codex.snapshot().status)));
  app.use('/api/media', mediaPreviewRoutes(previews, repository));
  app.use('/project-media', projectMediaRoutes(mediaFiles));
  app.use('/media', express.static(mediaDir, {dotfiles: 'deny'}));
  app.use('/thumbnails', express.static(thumbnailDir));
  app.use('/exports', express.static(exportDir));
  app.use('/api/media', waveformRoutes(repository, waveforms));
  app.get('/api/project', (_req, res) => res.json(repository.snapshot()));
  app.get('/api/status', (_req, res) => res.json({agentLastSeen, agentConnections: agents.active(), editorContext, sequenceId: activeSequenceId(repository.snapshot().project), platform: process.platform, projectPath: path.join(dataDir, 'project.json'), rootDir}));
  app.post('/api/agent/presence', (req, res) => {
    const {id, clientName, state} = z.object({id: z.string().uuid(), clientName: z.string().min(1).max(120), state: z.enum(['connected', 'disconnected'])}).parse(req.body);
    if(state === 'connected') agents.heartbeat(id, clientName); else agents.disconnect(id);
    res.json({ok: true});
  });
  app.post('/api/context', (req, res) => {
    const {projectId, sequenceId, ...context} = z.object({projectId: z.string().optional(), sequenceId: z.string().optional(), frame: z.number().int().nonnegative(), selectedId: z.string().nullable(), selectedTrackId: z.string().nullable().default(null)}).parse(req.body);
    if(projectId && projectId !== repository.snapshot().project.id) return res.status(409).json({error: 'Editor context belongs to another project'});
    if(sequenceId && sequenceId !== activeSequenceId(repository.snapshot().project)) return res.status(409).json({error: 'Editor context belongs to another sequence'});
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
  app.post('/api/import', (req, res, next) => {res.locals.projectId = z.string().min(1).parse(req.query.projectId ?? repository.snapshot().project.id); res.locals.folderId = z.string().min(1).max(150).optional().parse(req.query.folderId); next();}, upload.single('file'), async (req, res) => {
    if(!req.file) throw new Error('Choose a media file');
    try {
      const asset = await media.import(req.file.path, req.file.originalname, res.locals.projectId, true);
      res.json(await repository.addImportedAsset(asset, res.locals.projectId, 'editor', res.locals.folderId));
      previews.prepare([asset]);
    } finally {await unlink(req.file.path).catch(() => undefined);}
  });
  app.post('/api/import-path', async (req, res) => {
    const {filePath, folderId} = z.object({filePath: z.string().min(1), folderId: z.string().min(1).max(150).optional()}).parse(req.body);
    if(!path.isAbsolute(filePath)) throw new Error('Use an absolute file path');
    const projectId = repository.snapshot().project.id;
    const asset = await media.import(filePath, path.basename(filePath), projectId);
    res.json(await repository.addImportedAsset(asset, projectId, 'codex', folderId));
    previews.prepare([asset]);
  });
  const nativePreview = new NativePreviewService(previews);
  app.use('/api/render', renderRoutes(repository, renders, encoders, nativePreview));
  app.get('/api/project/download', (_req, res) => res.attachment('framecraft-project.json').json(repository.snapshot().project));
  app.use(express.static(path.join(rootDir, 'dist')));
  app.use((error: Error & {status?: number; code?: string}, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if(isConnectionError(error)) {res.destroy(); return;}
    if(req.aborted || res.destroyed) return;
    if(res.headersSent) {next(error); return;}
    console.error(error.message); res.status(error.status || 400).json({error: error.message});
  });
  return {app, repository, renders, codex, analysis, presets, previews, audioEffects, audioMix, autoAudio, speedRamps, sounds, nativePreview, waveforms, transfers};
}
