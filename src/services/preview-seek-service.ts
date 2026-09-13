/** Ignore hidden, premounted clips when checking the decoder on screen. */
export function visiblePreviewVideos(root: HTMLElement | null): HTMLVideoElement[] {
  return [...(root?.querySelectorAll('video') ?? [])].filter(video => {
    if(!video.getClientRects().length) return false;
    for(let node: HTMLElement | null = video; node && node !== root; node = node.parentElement) {
      const style = getComputedStyle(node);
      if(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  });
}

/** Keep only the latest pointer target while a decoder finishes its current
 * seek. The deadline lets a user escape a broken clip instead of waiting on it. */
export function createPreviewSeekQueue(seek: (frame: number) => void, decoderBusy: () => boolean) {
  let target: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingSince = 0;
  const flush = () => {
    if(target === undefined) return;
    const remaining = 300 - (Date.now() - waitingSince);
    if(decoderBusy() && remaining > 0) {
      timer ??= setTimeout(() => {timer = undefined; flush();}, remaining);
      return;
    }
    clearTimeout(timer); timer = undefined;
    const frame = target; target = undefined; seek(frame);
  };
  return {
    seek(frame: number) {
      if(target === undefined) waitingSince = Date.now();
      target = frame;
      flush();
    },
    // Advance immediately when the decoder signals readiness, without polling.
    ready: flush,
    cancel() {clearTimeout(timer); timer = undefined; target = undefined;},
  };
}
