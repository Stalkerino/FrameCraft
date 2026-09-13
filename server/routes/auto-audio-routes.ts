import {Router} from 'express';
import {z} from 'zod';
import {autoAudioAnalyzeSchema,autoAudioApplySchema} from '../../shared/auto-audio';
import type {AutoAudioService} from '../services/auto-audio-service';
export function autoAudioRoutes(service:AutoAudioService) {
  const router=Router();
  router.post('/analyze',(req,res)=>res.status(202).json(service.create(autoAudioAnalyzeSchema.parse(req.body))));
  router.get('/reports/:id',async(req,res)=>{
    const report=await service.get(String(req.params.id));
    if(req.query.page===undefined)return res.json(report);
    const page=z.coerce.number().int().nonnegative().parse(req.query.page),size=z.coerce.number().int().min(1).max(200).default(100).parse(req.query.pageSize);
    res.json({...report,page,pageSize:size,activityCount:report.activity.length,cueCount:report.cues.length,activity:report.activity.slice(page*size,(page+1)*size),cues:report.cues.slice(page*size,(page+1)*size)});
  });
  router.post('/reports/:id/cancel',async(req,res)=>res.json(await service.cancel(String(req.params.id))));
  router.post('/apply',async(req,res)=>res.json(await service.apply(autoAudioApplySchema.parse(req.body),req.headers['x-framecraft-client']==='codex'?'codex':'editor')));
  return router;
}
