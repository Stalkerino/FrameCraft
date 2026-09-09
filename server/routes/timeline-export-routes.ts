import {Router} from 'express';
import {timelineExportSchema} from '../../shared/timeline-interchange';
import type {TimelineExportService} from '../services/timeline-export-service';
export function timelineExportRoutes(service: TimelineExportService) {
  const router = Router();
  router.post('/', async (req, res) => res.json(await service.create(timelineExportSchema.parse(req.body))));
  return router;
}
