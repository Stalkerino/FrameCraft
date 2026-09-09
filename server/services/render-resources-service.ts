import {availableParallelism, freemem} from 'node:os';

function availableRenderMemory() {
  // Node includes container/process memory limits when the OS exposes them.
  const available = process.availableMemory?.();
  return available && available > 0 ? Math.min(freemem(), available) : freemem();
}

export function renderResources(width: number, height: number) {
  const memory = availableRenderMemory();
  // Budget Chromium pages and decoded frame buffers together; leave memory for
  // the editor and OS. High resolution exports must not multiply RAM unchecked.
  const perWorker = 384 * 1024 ** 2 + width * height * 4 * 12;
  const concurrency = Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2), Math.floor(memory * .5 / perWorker)));
  return {concurrency, offthreadVideoThreads: concurrency,
    offthreadVideoCacheSizeInBytes: Math.max(64 * 1024 ** 2, Math.min(1024 ** 3, Math.floor(memory * .1)))};
}

/** A fail-fast ceiling for unexpected filter buffering, not a frame cache target. */
export function filterFrameBudget(width: number, height: number, memory = availableRenderMemory()) {
  // Reserve at most 1/8 of available memory (and never more than 256 MiB) for
  // queued frames. RGBA64 is the conservative worst case during composition.
  const bytes = Math.min(256 * 1024 ** 2, memory / 8);
  return Math.max(4, Math.min(64, Math.floor(bytes / (width * height * 8))));
}
