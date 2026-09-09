import type {CSSProperties} from 'react';
import type {EffectName} from '../../../shared/project';

export interface TransitionDefinition {name: string; description: string; style: (progress: number) => CSSProperties}
/** Deterministic, frame-based effects shared by preview and export. Add custom effects here. */
export const transitions: Record<EffectName, TransitionDefinition> = {
  none: {name: 'Cut', description: 'A clean, instant cut', style: () => ({})},
  fade: {name: 'Dissolve', description: 'A soft blend between scenes', style: p => ({opacity: p})},
  slide: {name: 'Push', description: 'Bring the next scene in from the right', style: p => ({transform: `translateX(${(1 - p) * 100}%)`})},
  diagonal: {name: 'Diagonal wipe', description: 'An angled reveal with a cinematic edge', style: p => ({clipPath: `polygon(0 0, ${p * 135}% 0, ${p * 135 - 35}% 100%, 0 100%)`})},
  pixel: {name: 'Pixel reveal', description: 'A stepped reveal inspired by game worlds', style: p => {
    if(p >= 1) return {};
    const steps = Array.from({length: 10}, (_, i) => {
      const edge = Math.max(0, Math.min(100, Math.floor((p * 13 - (i * 7 % 4)) * 10) / 10 * 10));
      return `${edge}% ${i * 10}%, ${edge}% ${(i + 1) * 10}%`;
    }).join(', ');
    return {clipPath: `polygon(0 0, ${steps}, 0 100%)`};
  }},
};
