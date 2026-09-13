export interface ProbeTiming {duration?: string | number; duration_ts?: string | number; time_base?: string}

/** ffprobe's decimal duration is rounded (usually to six places). Stream
 * ticks retain the exact endpoint needed for frame-boundary validation. */
export function probeDuration(stream: ProbeTiming | undefined, formatDuration?: string | number): number {
  const ticks = Number(stream?.duration_ts);
  const parts = stream?.time_base?.split('/').map(Number);
  if(Number.isSafeInteger(ticks) && ticks > 0 && parts?.length === 2
    && parts.every(value => Number.isSafeInteger(value) && value > 0)) {
    const duration = ticks * parts[0] / parts[1];
    if(Number.isFinite(duration) && duration > 0) return duration;
  }
  const duration = Number(stream?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : Number(formatDuration);
}
