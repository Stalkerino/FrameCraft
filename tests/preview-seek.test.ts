import {afterEach, expect, it, vi} from 'vitest';
import {createPreviewSeekQueue} from '../src/services/preview-seek-service';
afterEach(() => vi.useRealTimers());

it('finishes the current decoder seek before sending only the latest drag target', () => {
  vi.useFakeTimers();
  const seek = vi.fn(); let busy = true;
  const queue = createPreviewSeekQueue(seek, () => busy);
  queue.seek(10); vi.advanceTimersByTime(20); queue.seek(20); queue.seek(30);
  vi.advanceTimersByTime(50); expect(seek).not.toHaveBeenCalled();
  busy = false; queue.ready();
  expect(seek.mock.calls).toEqual([[30]]);
  busy = true; queue.seek(40); queue.cancel(); vi.runAllTimers(); expect(seek).toHaveBeenCalledTimes(1);
});
it('seeks immediately when the decoder is already ready', () => {
  const seek = vi.fn(); const queue = createPreviewSeekQueue(seek, () => false);
  queue.seek(45); expect(seek).toHaveBeenCalledWith(45); queue.cancel();
});
it('allows seeking away from a decoder that never completes instead of deadlocking', () => {
  vi.useFakeTimers(); const seek = vi.fn();
  const queue = createPreviewSeekQueue(seek, () => true);
  queue.seek(12); vi.advanceTimersByTime(150); queue.seek(90); vi.advanceTimersByTime(170);
  expect(seek.mock.calls).toEqual([[90]]);
});
