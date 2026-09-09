import {useRef, useState} from 'react';
import type {Clip} from '../../../shared/project';
import {visualPropertyLimits, visualValueAtFrame, type VisualKeyframe, type VisualProperty} from '../../../shared/visual-editing';
import {useNormalizedDrag} from '../../hooks/useNormalizedDrag';

export function AnimationCurveEditor({clip, property, selectedFrame, localFrame, disabled, onSelect, onCommit}: {clip: Clip; property: VisualProperty; selectedFrame: number | null; localFrame: number; disabled: boolean; onSelect: (frame: number) => void; onCommit: (keys: VisualKeyframe[]) => void}) {
  const keys = clip.keyframes?.[property] ?? []; const offset = clip.motionOffset ?? 0; const end = Math.max(1, clip.duration - 1);
  const svg = useRef<SVGSVGElement>(null); const begin = useNormalizedDrag(svg, clip);
  const [draft, setDraft] = useState<VisualKeyframe[] | null>(null); const working = draft ?? keys;
  const limits = visualPropertyLimits[property]; const clamp = (value: number) => Math.max(limits[0], Math.min(limits[1], value));
  const samples = Array.from({length: 81}, (_, index) => clamp(visualValueAtFrame(keys, index / 80 * end + offset, clip[property] ?? 0)));
  const minimum = Math.min(...samples); const maximum = Math.max(...samples); const padding = Math.max((maximum - minimum) * .15, property === 'opacity' || property === 'scale' ? .1 : 5);
  const low = Math.max(limits[0], minimum - padding); const high = Math.min(limits[1], maximum + padding); const span = Math.max(.001, high - low);
  const y = (value: number) => 100 - (value - low) / span * 100;
  const path = Array.from({length: 81}, (_, index) => `${index ? 'L' : 'M'}${index / 80 * 100},${y(clamp(visualValueAtFrame(working, index / 80 * end + offset, clip[property] ?? 0)))}`).join(' ');
  return <div className="animation-curve">
    <div className="animation-curve__labels"><span>{Number(high.toFixed(2))}</span><span>Drag a key to change time and value</span></div>
    <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${property} animation curve`}>
      <path className="animation-curve__grid" d="M0 25H100M0 50H100M0 75H100M25 0V100M50 0V100M75 0V100"/>
      <path className="animation-curve__line" d={path}/><path className="animation-curve__playhead" d={`M${localFrame / end * 100} 0V100`}/>
      {working.filter(key => key.frame >= offset && key.frame <= offset + end).map(key => <circle key={key.frame} className={`geometry-editor__handle ${selectedFrame === key.frame ? 'geometry-editor__handle--selected' : ''}`} cx={(key.frame - offset) / end * 100} cy={y(key.value)} r="2" role="button" aria-label={`Move animation key at frame ${key.frame - offset}`} onPointerDown={event => {
        onSelect(key.frame); if(disabled) return;
        begin(event, point => working.map(previous => previous === key ? {...key, frame: Math.max(0, Math.round(point.x / 100 * end) + offset), value: clamp(low + (100 - point.y) / 100 * span)} : previous).sort((a, b) => a.frame - b.frame), setDraft, next => {onCommit(next); const moved = next.find(candidate => !keys.some(previous => previous.frame === candidate.frame && previous.value === candidate.value)); if(moved) onSelect(moved.frame);});
      }}/>) }
    </svg>
    <div className="animation-curve__labels"><span>{Number(low.toFixed(2))}</span><span>0 → {end} frames</span></div>
  </div>;
}
