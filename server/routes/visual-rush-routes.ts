import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {analyzeVideoSchema, applyVideoCutSchema, inspectVideoSchema, saveVideoCutSchema, visualCutCommands} from '../../shared/visual-rush';
import type {AnalysisService} from '../services/analysis-service';
import type {ProjectRepository} from '../repositories/project-repository';
export function visualRushRoutes(analysis: AnalysisService, repository: ProjectRepository) {
  const router = Router(); const service = analysis.visual;
  router.get('/', async (_req, res) => {const project = repository.snapshot().project; res.json({reports: await service.repository.reports(project.assets.map(a => a.id)), cuts: await service.repository.cuts(project.id)});});
  router.post('/analyze', (req, res) => {const input = analyzeVideoSchema.parse(req.body); res.status(202).json(analysis.analyzeVideo(repository.snapshot().project, input.assetId, input.refresh));});
  router.get('/reports/:id', async (req, res) => {const report = await service.repository.report(z.string().uuid().parse(req.params.id)); if(!repository.snapshot().project.assets.some(a => a.id === report.assetId)) throw new Error('This source is not in the active project'); res.json(report);});
  router.post('/inspect', async (req, res) => res.json(await service.inspect(repository.snapshot().project, inspectVideoSchema.parse(req.body))));
  router.post('/cuts', async (req, res) => res.json(await service.save(repository.snapshot().project, saveVideoCutSchema.parse(req.body))));
  router.post('/apply', async (req, res) => {
    const input = applyVideoCutSchema.parse(req.body); const project = repository.snapshot().project; const proposal = await service.repository.cut(input.id);
    const commands = visualCutCommands(project, proposal, input, randomUUID);
    res.json(await repository.execute(commands, input.revision, req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor', `Applied gameplay cut: ${proposal.title}`));
  });
  return router;
}
