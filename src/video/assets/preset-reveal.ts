import type {CSSProperties} from 'react';
import type {PresetDefinition} from '../../../shared/asset-presets';
export function presetRevealStyle(reveal: PresetDefinition['reveal'], progress: number): CSSProperties {
  const p = Math.min(1, Math.max(0, progress)); if(p >= 1 || !reveal) return {};
  if(reveal.type === 'fade') return {opacity: p};
  if(reveal.type === 'iris') return {clipPath: `circle(${p * 150}% at 50% 50%)`};
  if(reveal.type === 'wipe') {
    const amount = (1 - p) * 100;
    return {clipPath: `inset(${reveal.direction === 'up' ? amount : 0}% ${reveal.direction === 'right' ? amount : 0}% ${reveal.direction === 'down' ? amount : 0}% ${reveal.direction === 'left' ? amount : 0}%)`};
  }
  if(p <= 0) return {clipPath: 'inset(0 100% 0 0)'};
  const points = Array.from({length: reveal.steps}, (_, i) => {
    const edge = Math.max(0, Math.min(100, (p * 1.4 - (i * 7 % 5) * .08) * 100));
    return `${edge}% ${i / reveal.steps * 100}%, ${edge}% ${(i + 1) / reveal.steps * 100}%`;
  });
  return {clipPath: `polygon(0 0, ${points.join(', ')}, 0 100%)`};
}
