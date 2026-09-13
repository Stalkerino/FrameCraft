import {availableParallelism, freemem} from 'node:os';

function availableRenderMemory() {
  // Node includes container/process memory limits when the OS exposes them.
  const available = process.availableMemory?.();
  return available && available > 0 ? Math.min(freemem(), available) : freemem();
}

export function renderResources(width: number, height: number, limits: {hardware?: boolean; memory?: number; parallelism?: number; maxWorkers?: number} = {}) {
  const memory = limits.memory ?? availableRenderMemory();
  // Budget Chromium pages and decoded frame buffers together; leave memory for
  // the editor and OS. High resolution exports must not multiply RAM unchecked.
  const perWorker = 384 * 1024 ** 2 + width * height * 4 * 12;
  const requested = limits.maxWorkers ?? Number(process.env.FRAMECRAFT_RENDER_WORKERS || 4);
  const maxWorkers = Math.min(limits.hardware ? 2 : 8, Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 4);
  const cache = Math.max(16 * 1024 ** 2, Math.min(256 * 1024 ** 2, Math.floor(memory * .05)));
  const workerBudget = Math.max(0, Math.min(2 * 1024 ** 3, memory * .25) - cache);
  const concurrency = Math.max(1, Math.min(maxWorkers, Math.floor((limits.parallelism ?? availableParallelism()) / 2), Math.floor(workerBudget / perWorker)));
  return {concurrency, offthreadVideoThreads: concurrency,
    offthreadVideoCacheSizeInBytes: cache};
}

/** A fail-fast ceiling for unexpected filter buffering, not a frame cache target. */
export function filterFrameBudget(width: number, height: number, memory = availableRenderMemory()) {
  // Reserve at most 1/8 of available memory (and never more than 256 MiB) for
  // queued frames. RGBA64 is the conservative worst case during composition.
  const bytes = Math.min(256 * 1024 ** 2, memory / 8);
  return Math.max(4, Math.min(64, Math.floor(bytes / (width * height * 8))));
}
