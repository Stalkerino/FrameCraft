import {Router} from 'express';
import {z} from 'zod';
import {checkpointSchema, restoreProjectSchema, relinkMediaSchema, packageProjectSchema, importPackageSchema} from '../../shared/project-care';
import type {ProjectRepository} from '../repositories/project-repository';
import type {ProjectMediaService} from '../services/project-media-service';
import type {ProjectTransferService} from '../services/project-transfer-service';
export function projectCareRoutes(projects: ProjectRepository, media: ProjectMediaService, transfers: ProjectTransferService, isAgentWorking: () => boolean) {
  const router = Router();
  router.use((req, _res, next) => {
    if(req.method === 'POST' && ['restore', 'relink'].some(action => req.path === `/${action}`) && req.headers['x-framecraft-client'] !== 'codex' && isAgentWorking()) throw Object.assign(new Error('Stop the agent response before restoring a project or replacing media.'), {status: 409});
    next();
  });
  router.get('/versions', async (_req, res) => res.json(await projects.listRecovery()));
  router.post('/versions', async (req, res) => {const input = checkpointSchema.parse(req.body); res.json(await projects.saveCheckpoint(input.revision, input.label));});
  router.post('/restore', async (req, res) => {const input = restoreProjectSchema.parse(req.body); res.json(await projects.restoreCheckpoint(input.revision, input.id, req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor'));});
  router.get('/media', async (_req, res) => res.json(await media.health()));
  router.post('/relink', async (req, res) => res.json(await media.relink(relinkMediaSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.get('/transfers', (_req, res) => res.json(transfers.list()));
  router.post('/package', (req, res) => {const input = packageProjectSchema.parse(req.body); res.json(transfers.export(input.directory, input.revision));});
  router.post('/import-package', (req, res) => {const input = importPackageSchema.parse(req.body); res.json(transfers.import(input.directory, req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor'));});
  router.get('/transfers/:id', (req, res) => res.json(transfers.get(z.string().uuid().parse(req.params.id))));
  router.post('/transfers/:id/cancel', (req, res) => res.json(transfers.cancel(z.string().uuid().parse(req.params.id))));
  return router;
}
