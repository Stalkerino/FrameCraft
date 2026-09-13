import type {ColorScopeService} from '../services/color-scope-service';
import {z} from 'zod';
import type {ColorLibraryService} from '../services/color-library-service';
import {Router} from 'express';
import {colorGradeRequestSchema} from '../../shared/color-grade-editing';
import type {ColorGradingService} from '../services/color-grading-service';
export function colorGradingRoutes(service: ColorGradingService, library: ColorLibraryService, scopes: ColorScopeService) {
  const router = Router();
  router.post('/', async (req, res) => res.json(await service.set(colorGradeRequestSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  router.post('/scopes', (req,res) => {const body=z.object({revision:z.number().int().nonnegative(),frame:z.number().int().nonnegative()}).parse(req.body);res.status(202).json(scopes.create(body.revision,body.frame));});
  router.get('/scopes/:id',async(req,res)=>res.json(await scopes.get(z.string().uuid().parse(req.params.id))));
  router.get('/luts', async (_req,res) => res.json(await library.list()));
  router.post('/luts/import', async (req,res) => {const body=z.object({text:z.string().max(20_000_000),name:z.string().max(160),revision:z.number().int().nonnegative()}).parse(req.body);res.json(await library.import(body.text,body.name,body.revision,req.headers['x-framecraft-client']==='codex'?'codex':'editor'));});
  router.post('/luts/attach',async(req,res)=>{const body=z.object({id:z.string(),revision:z.number().int().nonnegative()}).parse(req.body);res.json(await library.attach(body.id,body.revision,req.headers['x-framecraft-client']==='codex'?'codex':'editor'));});
  return router;
}
