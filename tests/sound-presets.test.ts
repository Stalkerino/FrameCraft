import {describe, expect, it} from 'vitest';
import {soundDefinitionSchema, soundStarters} from '../shared/sound-presets';
import {soundSampleRate, synthesizeSound} from '../server/services/sound-synthesis-service';

describe('procedural sound library', () => {
  it('produces deterministic bounded PCM with silent edges for every starter', () => {
    for(const sound of soundStarters) {
      const wav = synthesizeSound(sound.definition); expect(wav.equals(synthesizeSound(sound.definition))).toBe(true);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.readUInt16LE(20)).toBe(1); expect(wav.readUInt16LE(22)).toBe(1); expect(wav.readUInt32LE(24)).toBe(soundSampleRate);
      expect(wav.length).toBe(44 + Math.round(sound.definition.duration * soundSampleRate) * 2);
      let peak = 0; for(let index = 44; index < wav.length; index += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(index)));
      expect(peak).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(Math.round(.8 * 32767));
      expect(wav.readInt16LE(44)).toBe(0); expect(wav.readInt16LE(wav.length - 2)).toBe(0);
    }
  });
  it('validates synthesis bounds and applies duration and silence overrides', () => {
    const definition = soundStarters[0].definition;
    expect(soundDefinitionSchema.safeParse({...definition, duration: 10}).success).toBe(false);
    expect(soundDefinitionSchema.safeParse({...definition, layers: [{...definition.layers[0], start: .8, end: .2}]}).success).toBe(false);
    const muted = synthesizeSound(definition, {duration: .2, volume: 0});
    expect(muted.length).toBe(44 + soundSampleRate * .2 * 2); expect(muted.subarray(44).every(value => value === 0)).toBe(true);
  });
});
