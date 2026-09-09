import {z} from 'zod';

export const audioKeyframeSchema = z.object({frame: z.number().int().nonnegative(), value: z.number().min(0).max(1)});
export const audioEnvelopeSchema = z.object({
  duration: z.number().int().positive(),
  // Negative offsets retain the original envelope when a head trim is extended.
  offset: z.number().int().default(0),
  fadeIn: z.number().int().nonnegative().default(0),
  fadeOut: z.number().int().nonnegative().default(0),
  keyframes: z.array(audioKeyframeSchema).default([]),
}).superRefine((value, context) => {
  if(value.fadeIn > value.duration || value.fadeOut > value.duration) context.addIssue({code: z.ZodIssueCode.custom, message: 'Audio fades must fit inside the envelope duration.'});
  for(const [index, point] of value.keyframes.entries()) {
    if(point.frame > value.duration) context.addIssue({code: z.ZodIssueCode.custom, message: 'Audio keyframes must fit inside the envelope duration.', path: ['keyframes', index, 'frame']});
    if(index && point.frame <= value.keyframes[index - 1].frame) context.addIssue({code: z.ZodIssueCode.custom, message: 'Audio keyframes must be ordered with distinct frame positions.', path: ['keyframes', index, 'frame']});
  }
});
export type AudioEnvelope = z.infer<typeof audioEnvelopeSchema>;
export type AudioKeyframe = z.infer<typeof audioKeyframeSchema>;
type OptionalEnvelope = AudioEnvelope | null | undefined;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Gain at a clip-local frame; source trims do not change the envelope's clock. */
export function audioEnvelopeGain(envelope: OptionalEnvelope, localFrame: number): number {
  if(!envelope) return 1;
  const frame = localFrame + envelope.offset;
  const fadeIn = envelope.fadeIn ? clamp(frame / envelope.fadeIn) : 1;
  const fadeOut = envelope.fadeOut ? clamp((envelope.duration - frame) / envelope.fadeOut) : 1;
  return fadeIn * fadeOut * keyframeGain(envelope.keyframes, frame);
}

export function keyframeGain(points: AudioKeyframe[], frame: number): number {
  if(!points.length) return 1;
  if(frame <= points[0].frame) return points[0].value;
  // Long ducking envelopes are queried once per playback frame.
  let low = 0; let high = points.length - 1;
  while(low + 1 < high) {const middle = (low + high) >>> 1; if(points[middle].frame <= frame) low = middle; else high = middle;}
  const left = points[low]; const right = points[high];
  if(frame >= right.frame) return right.value;
  return left.value + (right.value - left.value) * (frame - left.frame) / (right.frame - left.frame);
}

export function shiftAudioEnvelope(envelope: OptionalEnvelope, frames: number): OptionalEnvelope {
  return envelope ? {...envelope, offset: envelope.offset + frames} : envelope;
}

/** Resample boundaries and coalesce keyframes that land on the same output frame. */
export function reframeAudioEnvelope(envelope: OptionalEnvelope, ratio: number): OptionalEnvelope {
  if(!envelope) return envelope;
  const frame = (value: number) => Math.round(value * ratio);
  const duration = Math.max(1, frame(envelope.duration));
  const points = new Map<number, AudioKeyframe>();
  for(const point of envelope.keyframes) {const position = Math.min(duration, frame(point.frame)); points.set(position, {frame: position, value: point.value});}
  return {...envelope, duration, offset: frame(envelope.offset), fadeIn: Math.min(duration, frame(envelope.fadeIn)), fadeOut: Math.min(duration, frame(envelope.fadeOut)), keyframes: [...points.values()]};
}

/** Remotion's rendered volume curves use a half-frame window around each frame. */
export function audioVolumeFilter(envelope: OptionalEnvelope, fps: number, volume: number): string {
  if(!envelope) return `volume=${volume}`;
  const f = `(if(isnan(t),0,floor(t*${fps}+0.5))+${envelope.offset})`;
  const factors = [String(volume)];
  if(envelope.fadeIn) factors.push(`clip(${f}/${envelope.fadeIn},0,1)`);
  if(envelope.fadeOut) factors.push(`clip((${envelope.duration}-${f})/${envelope.fadeOut},0,1)`);
  if(envelope.keyframes.length) {
    // A flat sum of clamped linear ramps avoids deeply nested FFmpeg if() calls.
    const terms = [String(envelope.keyframes[0].value)];
    for(let index = 1; index < envelope.keyframes.length; index++) {
      const before = envelope.keyframes[index - 1]; const after = envelope.keyframes[index];
      if(after.value !== before.value) terms.push(`(${after.value - before.value})*clip((${f}-${before.frame})/${after.frame - before.frame},0,1)`);
    }
    factors.push(`clip((${terms.join('+')}),0,1)`);
  }
  return `volume='${factors.join('*')}':eval=frame`;
}
