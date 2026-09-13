import {Router} from 'express';
import type {ProjectRepository} from '../repositories/project-repository';
import type {WaveformService} from '../services/waveform-service';
export function waveformRoutes(projects: ProjectRepository, waveforms: WaveformService) {
  const router = Router();
  router.get('/:id/waveform', (req, res) => {
    const asset = projects.snapshot().project.assets.find(asset => asset.id === req.params.id);
    if(!asset) return res.status(404).json({error: 'Media not found in this project.'});
    res.json(waveforms.get(asset));
  });
  return router;
}
