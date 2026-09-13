import {Router} from 'express';
import {activeSequenceId, projectForSequence} from '../../shared/project-sequences';
import {z} from 'zod';
import {codecNames, exportSettingsSchema, extensionFor} from '../../shared/media-settings';
import {defaultExportPath} from '../services/export-destination-service';
import {dataDir} from '../config';
import {isConnectionError} from '../http/connection-errors';
import path from 'node:path';
import type {ProjectRepository} from '../repositories/project-repository';
import type {RenderService} from '../services/render-service';
import type {EncoderService} from '../services/encoder-service';
import {planProjectRender} from '../services/render-plan-service';
import type {NativePreviewService} from '../services/native-preview-service';

export function renderRoutes(repository: ProjectRepository, renders: RenderService, encoders: EncoderService, nativePreview: NativePreviewService) {
  const router = Router();
  router.get('/destination', (req, res) => {
    const project = projectForSequence(repository.snapshot().project, z.string().min(1).max(100).optional().parse(req.query.sequenceId));
    const codec = z.enum(codecNames).default('h264').parse(req.query.codec);
    res.json({projectId: project.id, sequenceId: activeSequenceId(project), outputPath: defaultExportPath(dataDir, project, extensionFor(codec))});
  });
  router.get('/encoders', async (req, res) => {res.json(await encoders.capabilities(z.enum(codecNames).default('h264').parse(req.query.codec), z.enum(['compatible', 'native-gpu', 'native-vulkan']).default('compatible').parse(req.query.renderer)));});
  router.post('/plan', (req, res) => {res.json(planProjectRender(repository.snapshot().project, req.body));});
  router.post('/native-preview', async (req, res) => {res.json(await nativePreview.scene(repository.snapshot().project, req.body));});
  router.post('/', (req, res) => {
    const body = z.object({kind: z.enum(['video', 'frame']), sequenceId: z.string().min(1).max(100).optional(), frame: z.number().int().optional(), settings: exportSettingsSchema.optional(), revision: z.number().int().optional(), outputPath: z.string().min(1).max(4096).optional()}).parse(req.body);
    const project = projectForSequence(repository.snapshot().project, body.sequenceId);
    if(body.revision !== undefined && body.revision !== project.revision) throw Object.assign(new Error('Project changed. Reopen export settings before exporting.'), {status: 409});
    res.status(202).json(renders.create(project, body.kind, body.frame, body.settings, body.outputPath));
  });
  router.get('/:id', (req, res) => {const job = renders.jobs.get(req.params.id); if(!job) return res.status(404).json({error: 'Render job not found'}); res.json(job);});
  router.get('/:id/output', async (req, res) => {res.json(await renders.output(req.params.id));});
  router.get('/:id/file', async (req, res, next) => {
    const output = await renders.output(req.params.id);
    // A verified job may live in a hidden project folder; no arbitrary path is
    // accepted by this route, so allow that specific file through sendFile.
    res.download(output.path, renders.jobs.get(req.params.id)?.filename || path.basename(output.path), {dotfiles: 'allow'}, error => {
      if(isConnectionError(error)) {res.destroy(); return;}
      if(error && !req.aborted && !res.destroyed) next(error);
    });
  });
  return router;
}
