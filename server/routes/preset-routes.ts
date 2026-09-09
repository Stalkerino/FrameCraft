import {Router} from 'express';
import {z} from 'zod';
import {presetApplySchema, presetPreviewSchema, presetSaveSchema} from '../../shared/asset-presets';
import type {PresetService} from '../services/preset-service';
export function presetRoutes(service: PresetService) {
  const router = Router(); const library = service.library;
  router.get('/', (_req, res) => res.json(library.snapshot()));
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
    const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    send({revision: library.snapshot().revision}); library.on('change', send);
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => {library.off('change', send); clearInterval(timer);});
  });
  router.post('/save', async (req, res) => res.json(await library.save(presetSaveSchema.parse(req.body))));
  router.post('/apply', async (req, res) => res.json(await service.apply(presetApplySchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.post('/preview', (req, res) => res.status(202).json(service.preview(presetPreviewSchema.parse(req.body))));
  router.post('/:id/remove', async (req, res) => {const {version} = z.object({version: z.number().int().positive()}).strict().parse(req.body); res.json(await library.remove(req.params.id, version));});
  router.get('/:id/download', (req, res) => {const preset = library.get(req.params.id); res.attachment(`${preset.id}.framecraft.json`).json({format: 'framecraft-asset-preset', version: 1, definition: preset.definition});});
  router.get('/:id/thumbnail.svg', (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.type('image/svg+xml').send(service.thumbnail(req.params.id));
  });
  router.get('/:id', (req, res) => res.json(library.get(req.params.id)));
  return router;
}
