import {ProcessError, runProcess} from './process-service';

export interface EncodingProgress {frame: number; outTimeUs: number; totalSize: number}
export interface EncodingProcessOptions {
  signal?: AbortSignal;
  onProgress?: (progress: EncodingProgress) => void;
  initialProgressTimeoutMs?: number;
  stalledProgressTimeoutMs?: number;
  onDiagnostic?: (chunk: string) => void;
}

export class EncodingStalledError extends Error {
  readonly name = 'EncodingStalledError';
  constructor(readonly lastProgress: EncodingProgress, readonly timeoutMs: number, cause: ProcessError) {
    super(`Encoding made no progress for ${timeoutMs / 1000} seconds (frame ${lastProgress.frame}).${cause.stderr.trim() ? `\n${cause.stderr.trim().slice(-1200)}` : ''}`, {cause});
  }
}

/** Run arguments containing -progress pipe:1, stopping stalled encoders before retrying. */
export async function runEncodingProcess(binary: string, args: string[], options: EncodingProcessOptions = {}): Promise<void> {
  const initialTimeout = options.initialProgressTimeoutMs ?? 45_000;
  const progressTimeout = options.stalledProgressTimeoutMs ?? 30_000;
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, {once: true});
  if(options.signal?.aborted) cancel();
  const stallReason = new Error('Encoder progress stalled');
  let timeoutMs = initialTimeout;
  let lastProgress: EncodingProgress = {frame: 0, outTimeUs: 0, totalSize: 0};
  const highWater = {...lastProgress};
  let block = {...lastProgress};
  let pending = '';
  let hasOutTimeUs = false;
  const stalled = () => controller.abort(stallReason);
  let timer = setTimeout(stalled, initialTimeout);
  timer.unref();
  const report = () => {
    const advanced = block.frame > highWater.frame || block.outTimeUs > highWater.outTimeUs || block.totalSize > highWater.totalSize;
    lastProgress = {...block};
    if(advanced) {
      highWater.frame = Math.max(highWater.frame, block.frame);
      highWater.outTimeUs = Math.max(highWater.outTimeUs, block.outTimeUs);
      highWater.totalSize = Math.max(highWater.totalSize, block.totalSize);
      timeoutMs = progressTimeout;
      clearTimeout(timer);
      timer = setTimeout(stalled, progressTimeout);
      timer.unref();
    }
    options.onProgress?.({...lastProgress});
    block = {...lastProgress};
    hasOutTimeUs = false;
  };
  try {
    await runProcess(binary, args, 24 * 60 * 60_000, {signal: controller.signal, onDiagnostic: options.onDiagnostic, onOutput: chunk => {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      // FFmpeg progress lines are short. Never retain arbitrary output between reads.
      pending = (lines.pop() ?? '').slice(-4096);
      for(const line of lines) {
        const separator = line.indexOf('=');
        if(separator < 0) continue;
        const key = line.slice(0, separator);
        const raw = line.slice(separator + 1).trim();
        if(key === 'progress' && (raw === 'continue' || raw === 'end')) {report(); continue;}
        if(!raw || !Number.isFinite(Number(raw))) continue;
        const value = Math.max(0, Number(raw));
        if(key === 'frame') block.frame = value;
        else if(key === 'total_size') block.totalSize = value;
        else if(key === 'out_time_us') {block.outTimeUs = value; hasOutTimeUs = true;}
        // Older FFmpeg calls this out_time_ms, but its value is microseconds too.
        else if(key === 'out_time_ms' && !hasOutTimeUs) block.outTimeUs = value;
      }
    }});
  } catch(error) {
    // A worker shutdown may race this timer. Preserve its actual abort reason.
    if(error instanceof ProcessError && error.kind === 'abort' && error.cause === stallReason) {
      throw new EncodingStalledError(lastProgress, timeoutMs, error);
    }
    throw error;
  } finally {clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);}
}
