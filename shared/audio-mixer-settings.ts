import {z} from 'zod';
export const trackMixSchema = z.object({gainDb:z.number().min(-60).max(24).default(0), pan:z.number().min(-1).max(1).default(0), solo:z.boolean().default(false)}).strict();
export const masterMixSchema = z.object({
  gainDb:z.number().min(-60).max(24).default(0), pan:z.number().min(-1).max(1).default(0), muted:z.boolean().default(false),
  normalization:z.object({targetLufs:z.number().min(-36).max(-5)}).nullable().optional(),
  limiter:z.object({ceilingDb:z.number().min(-12).max(0).default(-1)}).nullable().optional(),
}).strict();
export type TrackMix = z.infer<typeof trackMixSchema>;
export type MasterMix = z.infer<typeof masterMixSchema>;
export const setAudioMixerSchema=z.object({revision:z.number().int().nonnegative(),tracks:z.array(z.object({id:z.string().min(1),mix:trackMixSchema.nullable().optional(),muted:z.boolean().optional()})).optional(),master:masterMixSchema.nullable().optional()});
export const audioMixRequestSchema=z.object({revision:z.number().int().nonnegative(),measure:z.boolean().default(false)});
export interface AudioMeasurement {integratedLufs:number|null;truePeakDb:number|null;loudnessRange:number|null;samplePeakDb:number|null;leftPeakDb:number|null;rightPeakDb:number|null;normalizationGainDb?:number}
export interface AudioMixJob {id:string;projectId:string;sequenceId:string;revision:number;status:'queued'|'processing'|'done'|'error'|'cancelled';progress:number;url?:string;error?:string;master?:AudioMeasurement;tracks?:{id:string;name:string;levels:AudioMeasurement}[]}

