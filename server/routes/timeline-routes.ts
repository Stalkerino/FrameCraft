import {Router} from 'express';
import {timelineRangeRequestSchema} from '../../shared/timeline-range-request';
import type {TimelineService} from '../services/timeline-service';
export function timelineRoutes(service: TimelineService) {
  const router = Router();
  router.post('/ranges', async (req, res) => res.json(await service.ranges(timelineRangeRequestSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  return router;
}
