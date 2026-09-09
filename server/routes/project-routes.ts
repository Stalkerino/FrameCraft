import {Router} from 'express';
import {projectActionSchema} from '../../shared/project-library';
import type {ProjectRepository} from '../repositories/project-repository';
export function projectRoutes(repository: ProjectRepository, isAgentWorking: () => boolean) {
  const router = Router();
  router.get('/', async (_req, res) => res.json(await repository.listProjects()));
  router.post('/', async (req, res) => {
    const source = req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor';
    if(source === 'editor' && isAgentWorking()) throw Object.assign(new Error('Stop the current Codex response before switching projects.'), {status: 409});
    res.json(await repository.manageProject(projectActionSchema.parse(req.body), source));
  });
  return router;
}
