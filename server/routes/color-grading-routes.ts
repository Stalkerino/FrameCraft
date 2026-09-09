import {Router} from 'express';
import {colorGradeRequestSchema} from '../../shared/color-grade-editing';
import type {ColorGradingService} from '../services/color-grading-service';
export function colorGradingRoutes(service: ColorGradingService) {
  const router = Router();
  router.post('/', async (req, res) => res.json(await service.set(colorGradeRequestSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  return router;
}
