import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {access, rename, unlink} from 'node:fs/promises';
import type {Asset} from '../../shared/project';
import {mediaPreviewKey, type MediaPreview, type MediaPreviews, type PreviewQuality} from '../../shared/media-import';
import {MediaFileRepository} from '../repositories/media-file-repository';
import {ffmpegPath, ffprobePath, runProcess} from './process-service';

/** Versioned playback derivatives never replace originals or change project/undo data. */
export class MediaPreviewService extends EventEmitter {
  private states: MediaPreviews = {};
  private controllers = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private files: MediaFileRepository) {super();}
  snapshot(assets: Asset[]) {
    const ids = new Set(assets.map(asset => asset.id));
    return Object.fromEntries(Object.entries(this.states).filter(([, state]) => ids.has(state.assetId)).map(([key, state]) => [key, {...state}]));
  }
  private source(asset: Asset, quality: PreviewQuality) {
    return quality === 'performance' && asset.previewSrc && asset.previewSrc !== asset.src ? asset.previewSrc : asset.src.replace(/\.[^/.]+$/, '') + (quality === 'high' ? '-preview-full-v1.mp4' : '-preview.mp4');
  }
  private publish(state: MediaPreview) {this.states[mediaPreviewKey(state.assetId, state.quality ?? 'performance')] = state; this.emit('change');}
  /** Inspect caches on project open; encoding starts only when a monitor requests it. */
  ensure(assets: Asset[]) {
    for(const asset of assets) if(asset.kind === 'video') for(const quality of ['high', 'performance'] as const) {
      const key = mediaPreviewKey(asset.id, quality);
      if(this.states[key]) continue;
      const state: MediaPreview = {assetId: asset.id, quality, src: this.source(asset, quality), status: 'idle', progress: 0};
      this.states[key] = state;
      void this.inspect(state).then(ready => {
        // A monitor may have requested this variant while the disk check was pending.
        if(ready && this.states[key] === state) this.publish(ready);
      }).catch(() => undefined);
    }
  }
  private async inspect(state: MediaPreview): Promise<MediaPreview | undefined> {
    const target = this.files.resolve(state.src!);
    try {
      await access(target);
      const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', target], 15000));
      const stream = probe.streams?.[0];
      if(!stream?.width || !stream?.height) return undefined;
      return {...state, status: 'ready', progress: 1, width: stream.width, height: stream.height};
    } catch {return undefined;}
  }
  private schedule(asset: Asset, quality: PreviewQuality) {
    const key = mediaPreviewKey(asset.id, quality);
    const controller = new AbortController(); this.controllers.set(key, controller);
    const state: MediaPreview = {assetId: asset.id, quality, src: this.source(asset, quality), status: 'queued', progress: 0};
    this.publish(state);
    const release = () => {if(this.controllers.get(key) === controller) this.controllers.delete(key);};
    const failure = (error: unknown) => {if(!controller.signal.aborted) this.publish({...state, status: 'error', error: (error as Error).message}); release();};
    const run = async () => {
      if(controller.signal.aborted) {release(); return;}
      const target = this.files.resolve(state.src!); const temporary = `${target}.${randomUUID()}.partial.mp4`;
      try {
        this.publish({...state, status: 'running'});
        let pending = ''; let lastUpdate = 0;
        // Full quality retains source dimensions and frame rate. Only Performance
        // downsizes. Padding accommodates odd dimensions without blurring content.
        const filter = quality === 'high' ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2' : "scale=w='min(1280,iw)':h=-2:flags=lanczos";
        await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '2', '-i', this.files.resolve(asset.src), '-map', '0:v:0', '-map', '0:a:0?', '-vf', filter, '-filter_threads', '1', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', quality === 'high' ? '18' : '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', temporary], 24 * 60 * 60_000, {signal: controller.signal, onOutput: chunk => {
          pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop()!;
          for(const line of lines) if(line.startsWith('out_time_us=') && Date.now() - lastUpdate > 500) {
            const seconds = Number(line.slice(12)) / 1e6;
            if(Number.isFinite(seconds) && !controller.signal.aborted) {lastUpdate = Date.now(); this.publish({...state, status: 'running', progress: Math.max(0, Math.min(.99, seconds / asset.duration))});}
          }
        }});
        controller.signal.throwIfAborted(); await rename(temporary, target);
        this.publish(await this.inspect(state) ?? {...state, status: 'ready', progress: 1});
      } catch(error) {failure(error);}
      finally {release(); await unlink(temporary).catch(() => undefined);}
    };
    // Reuse an existing derivative before joining the one-at-a-time encode queue.
    void this.inspect(state).then(existing => {
      if(controller.signal.aborted) {release(); return;}
      if(existing) {this.publish(existing); release(); return;}
      this.queue = this.queue.then(run).catch(failure);
    }).catch(failure);
  }
  action(asset: Asset, action: 'cancel' | 'retry' | 'ensure', quality: PreviewQuality = 'high') {
    if(asset.kind !== 'video') throw new Error('Only video needs a playback copy');
    this.ensure([asset]);
    const key = mediaPreviewKey(asset.id, quality);
    if(action === 'cancel') {
      if(this.controllers.has(key)) {this.controllers.get(key)!.abort(); this.controllers.delete(key); this.publish({...this.states[key], status: 'cancelled', progress: 0});}
    } else if(!this.controllers.has(key) && this.states[key]?.status !== 'ready' && (action === 'retry' || this.states[key]?.status === 'idle')) this.schedule(asset, quality);
    return this.states[key];
  }
  close() {for(const controller of this.controllers.values()) controller.abort();}
}
