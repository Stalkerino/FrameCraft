import {z} from 'zod';

export const audioEffectsSchema = z.object({
  equalizer: z.object({low: z.number().min(-24).max(24).default(0), mid: z.number().min(-24).max(24).default(0), high: z.number().min(-24).max(24).default(0)}).optional(),
  compressor: z.object({threshold: z.number().min(-60).max(0).default(-18), ratio: z.number().min(1).max(20).default(4), attack: z.number().min(.01).max(2000).default(10), release: z.number().min(1).max(9000).default(180), makeup: z.number().min(0).max(24).default(0)}).optional(),
  reverb: z.object({wet: z.number().min(0).max(1).default(.2), room: z.number().min(0).max(1).default(.5)}).optional(),
}).strict().refine(value => value.equalizer || value.compressor || value.reverb, 'Choose at least one audio effect.');
export type AudioEffects = z.infer<typeof audioEffectsSchema>;
export const applyAudioEffectsSchema = z.object({revision: z.number().int().nonnegative(), clipIds: z.array(z.string().min(1)).min(1), effects: audioEffectsSchema});
export const audioProcessingSchema = z.object({sourceAssetId: z.string(), sourceStartSeconds: z.number().nonnegative(), effects: audioEffectsSchema});
export interface AudioEffectJob {id: string; projectId: string; status: 'queued' | 'processing' | 'done' | 'error' | 'cancelled'; progress: number; error?: string; revision?: number; clipIds?: string[]}

/** Numeric, validated filters only. Effects are rendered once and shared by playback/export. */
export function audioEffectFilters(input: AudioEffects): string {
  const effects = audioEffectsSchema.parse(input); const filters: string[] = [];
  if(effects.equalizer) {
    const {low, mid, high} = effects.equalizer;
    if(low) filters.push(`bass=g=${low}:f=180:t=q:w=.7`);
    if(mid) filters.push(`equalizer=f=1200:t=q:w=1:g=${mid}`);
    if(high) filters.push(`treble=g=${high}:f=5000:t=q:w=.7`);
  }
  if(effects.compressor) {
    const c = effects.compressor;
    filters.push(`acompressor=threshold=${10 ** (c.threshold / 20)}:ratio=${c.ratio}:attack=${c.attack}:release=${c.release}:makeup=${10 ** (c.makeup / 20)}`);
  }
  if(effects.reverb?.wet) {
    const {wet, room} = effects.reverb;
    const delays = [29, 43, 71, 97, 137, 181].map(value => Math.round(value * (.5 + room * 2)));
    const decays = delays.map((_, index) => wet * .6 ** (index + 1));
    // A compact multi-tap room effect. No convolution model or online service.
    filters.push(`aecho=1:${1 / (1 + decays.reduce((sum, value) => sum + value, 0))}:${delays.join('|')}:${decays.join('|')}`);
  }
  // Protect subsequent mixing without introducing limiter lookahead latency.
  filters.push('alimiter=limit=.95:level=false:latency=true');
  return filters.join(',');
}
