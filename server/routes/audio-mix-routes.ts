import {Router} from 'express';
import {audioDuckSchema} from '../../shared/audio-mix';
import type {AudioMixService} from '../services/audio-mix-service';
import {audioMixRequestSchema,setAudioMixerSchema} from '../../shared/audio-mixer';
import {isConnectionError} from '../http/connection-errors';
export function audioMixRoutes(service: AudioMixService) {
  const router = Router();
  router.post('/mixer',async(req,res)=>res.json(await service.set(setAudioMixerSchema.parse(req.body),req.headers['x-framecraft-client']==='codex'?'codex':'editor')));
  router.post('/mixes',async(req,res)=>res.json(service.create(audioMixRequestSchema.parse(req.body))));
  router.get('/mixes/:id',async(req,res)=>res.json(service.get(String(req.params.id))));
  router.post('/mixes/:id/cancel',async(req,res)=>res.json(service.cancel(String(req.params.id))));
  router.get('/mixes/:key/file',(req,res,next)=>res.sendFile(service.file(String(req.params.key)),{dotfiles:'allow'},error=>{if(error&&!isConnectionError(error)&&!res.headersSent)next(error);}));
  router.post('/duck', async (req, res) => res.json(await service.duck(audioDuckSchema.parse(req.body), req.headers['x-framecraft-client'] === 'codex' ? 'codex' : 'editor')));
  return router;
}
