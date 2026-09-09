import {Router} from 'express';
import {applySpeedSchema, resetSpeedSchema} from '../../shared/speed-ramping';
import type {SpeedRampService} from '../services/speed-ramp-service';

export function speedRampRoutes(service: SpeedRampService) {
  const router = Router();
  router.post('/apply', (req, res) => res.status(202).json(service.create(applySpeedSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.post('/reset', (req, res) => res.status(202).json(service.reset(resetSpeedSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.get('/jobs/:id', (req, res) => res.json(service.get(req.params.id)));
  router.post('/jobs/:id/cancel', (req, res) => res.json(service.cancel(req.params.id)));
  return router;
}
