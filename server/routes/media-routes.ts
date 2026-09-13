import {Router} from 'express';
import {isConnectionError} from '../http/connection-errors';
import path from 'node:path';
import {z} from 'zod';
import {previewQualities} from '../../shared/media-import';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import type {ProjectRepository} from '../repositories/project-repository';
import type {MediaPreviewService} from '../services/media-preview-service';

export function projectMediaRoutes(files: MediaFileRepository) {
  const router = Router();
  router.get('/:project/:folder/:filename', (req, res, next) => {
    // Only media and thumbnails are public; saved project/undo JSON stays private.
    const file = files.resolve(`/project-media/${req.params.project}/${req.params.folder}/${req.params.filename}`);
    res.sendFile(path.basename(file), {root: path.dirname(file), dotfiles: 'deny'}, error => {
      // Browsers routinely cancel a byte-range request when seeking or changing clips.
      if(isConnectionError(error)) {res.destroy(); return;}
      if(error && !req.aborted && !res.destroyed) next(error);
    });
  });
  return router;
}
export function mediaPreviewRoutes(previews: MediaPreviewService, repository: ProjectRepository) {
  const router = Router();
  router.get('/previews', (_req, res) => res.json(previews.snapshot(repository.snapshot().project.assets)));
  router.post('/:assetId/preview', (req, res) => {
    const {action, quality} = z.object({action: z.enum(['cancel', 'retry', 'ensure']), quality: z.enum(previewQualities).default('high')}).parse(req.body);
    const asset = repository.snapshot().project.assets.find(a => a.id === req.params.assetId);
    if(!asset) throw new Error('Media asset was not found in this project');
    res.json(previews.action(asset, action, quality));
  });
  return router;
}
