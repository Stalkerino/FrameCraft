import {Router} from 'express';
import {applyAudioEffectsSchema} from '../../shared/audio-effects';
import type {AudioEffectsService} from '../services/audio-effects-service';
export function audioEffectsRoutes(service: AudioEffectsService) {
  const router = Router();
  router.post('/apply', (req, res) => res.status(202).json(service.create(applyAudioEffectsSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.get('/jobs/:id', (req, res) => res.json(service.get(req.params.id)));
  router.post('/jobs/:id/cancel', (req, res) => res.json(service.cancel(req.params.id)));
  return router;
}
