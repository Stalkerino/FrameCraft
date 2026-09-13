import type {AudioWaveform, WaveformResult} from '../../shared/audio-waveform';
import {request} from './editor-api';
const cache = new Map<string, AudioWaveform>();
const pending = new Map<string, Promise<AudioWaveform>>();
export function loadWaveform(assetId: string, sourceKey = ''): Promise<AudioWaveform> {
  const key = `${assetId}:${sourceKey}`;
  const existing = cache.get(key); if(existing) return Promise.resolve(existing);
  const active = pending.get(key); if(active) return active;
  const operation = (async () => {
    for(;;) {
      const result = await request<WaveformResult>(`/api/media/${encodeURIComponent(assetId)}/waveform`);
      if(result.status === 'error') throw new Error(result.error || 'Waveform unavailable');
      if(result.status === 'ready' && result.waveform) {
        cache.set(key, result.waveform);
        let bins = [...cache.values()].reduce((sum, data) => sum + data.peaks.length, 0);
        for(const [id, data] of cache) {
          if(cache.size <= 64 && bins <= 1000000) break;
          if(id !== key) {bins -= data.peaks.length; cache.delete(id);}
        }
        return result.waveform;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  })().finally(() => pending.delete(key));
  pending.set(key, operation); return operation;
}
