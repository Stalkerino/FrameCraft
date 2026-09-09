import {Router} from 'express';
import {audioDuckSchema} from '../../shared/audio-mix';
import type {AudioMixService} from '../services/audio-mix-service';
export function audioMixRoutes(service: AudioMixService) {
  const router = Router();
  router.post('/duck', async (req, res) => res.json(await service.duck(audioDuckSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  return router;
}
