import {Router} from 'express';
import {isConnectionError} from '../http/connection-errors';
import path from 'node:path';
import {z} from 'zod';
import {soundApplySchema, soundPreviewSchema, soundSaveSchema} from '../../shared/sound-presets';
import type {SoundLibraryService} from '../services/sound-library-service';

export function soundRoutes(service: SoundLibraryService) {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.library.snapshot()));
  router.get('/audio/:filename', (req, res, next) => {
    const file = service.audioPath(req.params.filename);
    res.type('audio/wav').sendFile(path.basename(file), {root: path.dirname(file), dotfiles: 'deny'}, error => {
      if(isConnectionError(error)) {res.destroy(); return;}
      if(error && !req.aborted && !res.destroyed) next(error);
    });
  });
  router.post('/save', async (req, res) => res.json(await service.library.save(soundSaveSchema.parse(req.body))));
  router.post('/preview', async (req, res) => res.json(await service.preview(soundPreviewSchema.parse(req.body))));
  router.post('/apply', async (req, res) => res.json(await service.apply(soundApplySchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.post('/:id/remove', async (req, res) => {const {version} = z.object({version: z.number().int().positive()}).strict().parse(req.body); res.json(await service.library.remove(req.params.id, version));});
  router.get('/:id/download', (req, res) => {const sound = service.library.get(req.params.id); res.attachment(`${sound.id}.framecraft-sound.json`).json({format: 'framecraft-sound', version: 1, definition: sound.definition});});
  router.get('/:id', (req, res) => res.json(service.library.get(req.params.id)));
  return router;
}
