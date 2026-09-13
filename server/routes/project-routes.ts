import {Router} from 'express';
import {projectActionSchema} from '../../shared/project-library';
import {activeSequenceId, projectForSequence, sequenceSummaries} from '../../shared/project-sequences';
import type {ProjectRepository} from '../repositories/project-repository';
export function projectRoutes(repository: ProjectRepository, isAgentWorking: () => boolean) {
  const router = Router();
  router.get('/sequences', (_req, res) => {
    const project = repository.snapshot().project;
    res.json({projectId: project.id, revision: project.revision, activeId: activeSequenceId(project), sequences: sequenceSummaries(project)});
  });
  router.get('/sequences/:id', (req, res) => res.json(projectForSequence(repository.snapshot().project, req.params.id)));
  router.get('/', async (_req, res) => res.json(await repository.listProjects()));
  router.post('/', async (req, res) => {
    const source = req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor';
    if(source === 'editor' && isAgentWorking()) throw Object.assign(new Error('Stop the current Codex response before switching projects.'), {status: 409});
    res.json(await repository.manageProject(projectActionSchema.parse(req.body), source));
  });
  return router;
}
