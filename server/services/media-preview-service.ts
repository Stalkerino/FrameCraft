import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {access, rename, unlink} from 'node:fs/promises';
import type {Asset} from '../../shared/project';
import {mediaPreviewKey, previewQualities, type MediaPreview, type MediaPreviews, type PreviewQuality} from '../../shared/media-import';
import {MediaFileRepository} from '../repositories/media-file-repository';
import {ffprobePath, runProcess} from './process-service';
import {previewMediaSource} from './preview-encoding';
import {PreviewEncoderService} from './preview-encoder-service';

/** Versioned playback derivatives never replace originals or change project/undo data. */
export class MediaPreviewService extends EventEmitter {
  private states: MediaPreviews = {};
  private controllers = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private files: MediaFileRepository, private encoder = new PreviewEncoderService()) {super();}
  /** Import completion queues a reusable editing copy without awaiting encoding. */
  prepare(assets: Asset[]) {
    if(this.closed) return;
    for(const asset of assets) if(asset.kind === 'video' && !asset.demo) this.action(asset, 'ensure', 'performance');
  }
  snapshot(assets: Asset[]) {
    const ids = new Set(assets.map(asset => asset.id));
    return Object.fromEntries(Object.entries(this.states).filter(([, state]) => ids.has(state.assetId)).map(([key, state]) => [key, {...state}]));
  }
  private source(asset: Asset, quality: PreviewQuality) {
    return previewMediaSource(asset.src, quality);
  }
  private publish(state: MediaPreview) {
    const key = mediaPreviewKey(state.assetId, state.quality ?? 'performance');
    if(this.states[key]?.src && this.states[key].src !== state.src) return;
    this.states[key] = state; this.emit('change');
  }
  /** Inspect caches on project open; encoding starts only when a monitor requests it. */
  ensure(assets: Asset[]) {
    for(const asset of assets) if(asset.kind === 'video') for(const quality of previewQualities) {
      const key = mediaPreviewKey(asset.id, quality);
      if(this.states[key]?.src === this.source(asset, quality)) continue;
      this.controllers.get(key)?.abort(); this.controllers.delete(key);
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
      if(controller.signal.aborted || this.closed) {release(); return;}
      const target = this.files.resolve(state.src!); const temporary = `${target}.${randomUUID()}.partial.mp4`;
      try {
        this.publish({...state, status: 'running'});
        let lastUpdate = 0;
        await this.encoder.encode(asset, quality, this.files.resolve(asset.src), temporary, controller.signal,
          info => {if(!controller.signal.aborted) {Object.assign(state, info); this.publish({...state, status: 'running', progress: 0});}},
          progress => {
            if(Date.now() - lastUpdate > 500 && !controller.signal.aborted) {
              lastUpdate = Date.now(); this.publish({...state, status: 'running', progress: Math.max(0, Math.min(.99, progress.outTimeUs / 1e6 / asset.duration))});
            }
          });
        controller.signal.throwIfAborted(); await rename(temporary, target);
        const ready = await this.inspect(state);
        if(!ready) throw new Error('The playback copy could not be validated. Retry proxy preparation.');
        if(!controller.signal.aborted) this.publish(ready);
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
    if(this.closed) throw new Error('Preview service is closed');
    if(asset.kind !== 'video') throw new Error('Only video needs a playback copy');
    this.ensure([asset]);
    const key = mediaPreviewKey(asset.id, quality);
    if(action === 'cancel') {
      if(this.states[key]?.status !== 'ready') {this.controllers.get(key)?.abort(); this.controllers.delete(key); this.publish({...this.states[key], status: 'cancelled', progress: 0});}
    } else if(!this.controllers.has(key) && this.states[key]?.status !== 'ready' && (action === 'retry' || this.states[key]?.status === 'idle')) this.schedule(asset, quality);
    return this.states[key];
  }
  close() {this.closed = true; for(const controller of this.controllers.values()) controller.abort();}
}
