import {soundDefinitionSchema, soundValuesSchema, type SoundDefinition, type SoundValues} from '../../shared/sound-presets';

export const soundSampleRate = 48000;
/** Bounded deterministic synthesis: at most 192k samples and six simple layers. */
export function synthesizeSound(input: SoundDefinition, overrides: SoundValues = {}): Buffer {
  const definition = soundDefinitionSchema.parse(input); const values = soundValuesSchema.parse(overrides);
  const duration = values.duration ?? definition.duration; const pitch = values.pitch ?? definition.pitch;
  const volume = values.volume ?? definition.volume; const samples = Math.round(duration * soundSampleRate);
  const mix = new Float32Array(samples);
  for(const [index, layer] of definition.layers.entries()) {
    let random = (definition.seed + index * 7919) >>> 0; let phase = 0; let filtered = 0;
    const start = Math.floor(layer.start * samples); const end = Math.ceil(layer.end * samples); const length = end - start;
    for(let i = start; i < end; i++) {
      const progress = (i - start) / Math.max(1, length - 1);
      const frequency = Math.min(18000, (layer.frequency + (layer.endFrequency - layer.frequency) * progress) * pitch);
      phase += frequency / soundSampleRate;
      let value: number;
      if(layer.wave === 'noise') {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        const noise = (random >>> 0) / 2147483648 - 1;
        filtered += (1 - Math.exp(-2 * Math.PI * frequency / soundSampleRate)) * (noise - filtered);
        value = filtered;
      } else value = layer.wave === 'sine' ? Math.sin(2 * Math.PI * phase) : 2 / Math.PI * Math.asin(Math.sin(2 * Math.PI * phase));
      const envelope = Math.sin(Math.min(1, progress / layer.attack) * Math.PI / 2) ** 2 * Math.sin(Math.min(1, (1 - progress) / layer.release) * Math.PI / 2) ** 2;
      mix[i] += value * layer.gain * envelope;
    }
  }
  let peak = 0; for(const value of mix) peak = Math.max(peak, Math.abs(value));
  const gain = volume * Math.min(1, .8 / (peak || 1));
  const output = Buffer.alloc(44 + samples * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(soundSampleRate, 24); output.writeUInt32LE(soundSampleRate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(samples * 2, 40);
  for(let i = 0; i < samples; i++) {
    const edge = Math.min(1, i / 144, (samples - 1 - i) / 144);
    output.writeInt16LE(Math.round(Math.max(-.8, Math.min(.8, mix[i] * gain * edge)) * 32767), 44 + i * 2);
  }
  return output;
}
