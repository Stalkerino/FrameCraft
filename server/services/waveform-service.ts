import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Asset} from '../../shared/project';
import type {AudioWaveform, WaveformResult} from '../../shared/audio-waveform';
import type {MediaFileRepository} from '../repositories/media-file-repository';
import {ffmpegPath, runProcess} from './process-service';

/** Streaming stereo audio analysis: at most 100,000 bins, one decoder at a time.
 * No full PCM file, browser AudioBuffer, or video decoding is required. */
export class WaveformService {
  private states = new Map<string, WaveformResult>();
  private queue = Promise.resolve();
  private controller = new AbortController();
  constructor(private files: MediaFileRepository, private directory: string) {}
  private ready(key: string, waveform: AudioWaveform) {
    this.states.set(key, {status: 'ready', waveform});
    let bins = [...this.states.values()].reduce((sum, state) => sum + (state.waveform?.peaks.length ?? 0), 0);
    for(const [id, state] of this.states) {
      if(this.states.size <= 64 && bins <= 1000000) break;
      if(id !== key && ['ready', 'error'].includes(state.status)) {bins -= state.waveform?.peaks.length ?? 0; this.states.delete(id);}
    }
  }
  get(asset: Asset): WaveformResult {
    const key = createHash('sha256').update(`${asset.src}/${asset.duration}/v1`).digest('hex');
    const existing = this.states.get(key); if(existing) return existing;
    if(!['audio', 'video'].includes(asset.kind)) throw new Error('Waveforms require audio or video media.');
    if(this.controller.signal.aborted) throw new Error('Waveform service is closed.');
    this.states.set(key, {status: 'queued'});
    this.queue = this.queue.then(async () => {
      const file = path.join(this.directory, `${key}.json`);
      try {
        const waveform = JSON.parse(await readFile(file, 'utf8'));
        if(waveform.version === 1 && Array.isArray(waveform.peaks) && waveform.peaks.length <= 100000 && waveform.peaks.length === waveform.rms?.length && waveform.secondsPerBin > 0) {
          this.ready(key, waveform); return;
        }
      } catch { /* Missing caches are generated on demand. */ }
      this.states.set(key, {status: 'running'});
      const rate = 8000; const samplesPerBin = Math.max(80, Math.ceil(asset.duration * rate / 100000)) * 2;
      const peaks: number[] = []; const rms: number[] = [];
      let tail = Buffer.alloc(0); let count = 0; let total = 0; let peak = 0; let square = 0;
      const flush = () => {if(count && peaks.length < 100000) {peaks.push(Math.min(1, peak)); rms.push(Math.min(1, Math.sqrt(square / count)));} count = 0; peak = 0; square = 0;};
      await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-i', this.files.resolve(asset.src),
        '-map', '0:a:0?', '-vn', '-sn', '-dn', '-ac', '2', '-ar', String(rate), '-filter_threads', '1', '-threads', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], 24 * 60 * 60000,
      {signal: this.controller.signal, onOutput: chunk => {
        const bytes = tail.length ? Buffer.concat([tail, chunk]) : chunk; const end = bytes.length - bytes.length % 4;
        for(let i = 0; i < end; i += 4) {const sample = bytes.readFloatLE(i); const value = Number.isFinite(sample) ? Math.abs(sample) : 0; peak = Math.max(peak, value); square += value * value; total++; if(++count === samplesPerBin) flush();}
        tail = Buffer.from(bytes.subarray(end));
      }});
      flush();
      const waveform = {version: 1 as const, secondsPerBin: samplesPerBin / (rate * 2), peaks, rms, duration: total / (rate * 2)};
      await mkdir(this.directory, {recursive: true}); const temporary = `${file}.${randomUUID()}.tmp`;
      try {await writeFile(temporary, JSON.stringify(waveform)); await rename(temporary, file);}
      finally {await unlink(temporary).catch(() => undefined);}
      this.ready(key, waveform);
    }).catch(error => {this.states.set(key, {status: 'error', error: (error as Error).message});});
    return this.states.get(key)!;
  }
  close() {this.controller.abort();}
}
