import type {Asset} from '../../shared/project';
import type {PreviewQuality} from '../../shared/media-import';
import {EncoderService} from './encoder-service';
import {ffmpegPath} from './process-service';
import {gpuPreviewArguments, previewVideoArguments} from './preview-encoding';
import {runEncodingProcess, type EncodingProgress} from './ffmpeg-progress-service';
import {selectNativeGpuAdapter} from './rendering/native-gpu-adapters';

export interface PreviewEncodingInfo {encoding: string; warning?: string}

/** Reuses native decode/scale/encode adapters. One actual GPU attempt per job;
 * after a driver failure, this session uses bounded CPU work without GPU retries. */
export class PreviewEncoderService {
  private selection?: ReturnType<typeof selectNativeGpuAdapter>;
  private gpuFailure?: string;
  constructor(private encoders = new EncoderService()) {}
  async encode(asset: Asset, quality: PreviewQuality, input: string, output: string, signal: AbortSignal,
    onInfo: (info: PreviewEncodingInfo) => void, onProgress: (progress: EncodingProgress) => void) {
    const options = {signal, onProgress, initialProgressTimeoutMs: 45000, stalledProgressTimeoutMs: 30000};
    let warning = this.gpuFailure;
    if(!warning && ['h264', 'hevc', 'h265', 'vp9', 'av1', 'mpeg2video', 'vc1'].includes(asset.videoCodec ?? '') && asset.width && asset.height) {
      this.selection ??= this.encoders.previewCandidates().then(selectNativeGpuAdapter);
      // Handle inventory failure here, before any GPU has been initialized.
      const selected = await this.selection.catch(error => {warning = (error as Error).message; return undefined;});
      signal.throwIfAborted();
      if(selected) {
        try {
          const args = gpuPreviewArguments(asset, quality, input, output, selected.encoder, selected.adapter);
          onInfo({encoding: `GPU · ${selected.encoder.label}`});
          await runEncodingProcess(selected.encoder.binary, args, options);
          return;
        } catch(error) {
          signal.throwIfAborted();
          warning = this.gpuFailure = `GPU proxy failed; CPU is used for this session. ${(error as Error).message.slice(-700)}`;
        }
      }
    }
    signal.throwIfAborted();
    onInfo({encoding: 'CPU · 2 threads', warning: warning || 'No compatible GPU proxy path for this source or machine.'});
    await runEncodingProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2', '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?', ...previewVideoArguments(quality), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats', output], options);
  }
}
