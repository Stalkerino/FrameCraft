import type {AudioKeyframe} from './audio-envelope';

export interface DuckingRange {start: number; end: number}
export interface DuckingSettings {gain: number; attack: number; release: number}

/** Build editable, frame-based gain automation from clip-local foreground ranges. */
export function duckingKeyframes(duration: number, input: DuckingRange[], {gain, attack, release}: DuckingSettings): AudioKeyframe[] {
  if(!Number.isInteger(duration) || duration < 1 || !Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isInteger(attack) || attack < 0 || !Number.isInteger(release) || release < 0) throw new Error('Choose a valid duration, ducking gain and attack/release in frames.');
  const ranges: DuckingRange[] = [];
  for(const range of [...input].sort((a, b) => a.start - b.start)) {
    if(!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end <= range.start) throw new Error('Ducking ranges must have ordered frame boundaries.');
    const previous = ranges.at(-1);
    if(previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else ranges.push({...range});
  }
  const positions = new Set([0, duration]);
  const add = (frame: number) => {positions.add(Math.max(0, Math.min(duration, Math.floor(frame)))); positions.add(Math.max(0, Math.min(duration, Math.ceil(frame))));};
  for(const [index, range] of ranges.entries()) {
    // A zero-length attack/release is a one-frame edge in the editable curve.
    add(range.start - Math.max(1, attack)); add(range.start); add(range.end - (release ? 0 : 1)); add(range.end + release);
    const previous = ranges[index - 1];
    if(previous && attack && release && range.start - previous.end < attack + release) add((previous.end * attack + range.start * release) / (attack + release));
  }
  const valueAt = (frame: number) => ranges.reduce((value, range) => {
    if(frame < range.start) return Math.min(value, attack ? gain + (1 - gain) * Math.min(1, (range.start - frame) / attack) : 1);
    if(frame < range.end) return Math.min(value, gain);
    return Math.min(value, release ? gain + (1 - gain) * Math.min(1, (frame - range.end) / release) : 1);
  }, 1);
  const points: AudioKeyframe[] = [];
  for(const frame of [...positions].sort((a, b) => a - b)) {
    const point = {frame, value: valueAt(frame)};
    while(points.length > 1) {
      const a = points[points.length - 2]; const b = points[points.length - 1];
      const predicted = a.value + (point.value - a.value) * (b.frame - a.frame) / (point.frame - a.frame);
      if(Math.abs(predicted - b.value) > 1e-10) break;
      points.pop();
    }
    points.push(point);
  }
  return points;
}
