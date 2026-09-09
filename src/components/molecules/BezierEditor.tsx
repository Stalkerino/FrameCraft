import {useRef, useState} from 'react';
import type {VisualKeyframe} from '../../../shared/visual-editing';
import {useNormalizedDrag} from '../../hooks/useNormalizedDrag';
import {NumberField} from '../atoms/Field';

type Curve = NonNullable<VisualKeyframe['bezier']>;
export function BezierEditor({value, disabled, onChange}: {value: Curve; disabled: boolean; onChange: (value: Curve) => void}) {
  const svg = useRef<SVGSVGElement>(null); const begin = useNormalizedDrag(svg, value);
  const [draft, setDraft] = useState<Curve | null>(null); const curve = draft ?? value;
  const low = Math.min(0, value.y1, value.y2) - .15; const high = Math.max(1, value.y1, value.y2) + .15;
  const y = (value: number) => (high - value) / (high - low) * 100;
  return <div className="bezier-editor">
    <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Bezier easing handles">
      <path className="animation-curve__grid" d={`M0 ${y(0)}H100M0 ${y(1)}H100M50 0V100`}/>
      <path className="bezier-editor__guides" d={`M0 ${y(0)}L${curve.x1 * 100} ${y(curve.y1)}M100 ${y(1)}L${curve.x2 * 100} ${y(curve.y2)}`}/>
      <path className="animation-curve__line" d={`M0 ${y(0)}C${curve.x1 * 100} ${y(curve.y1)} ${curve.x2 * 100} ${y(curve.y2)} 100 ${y(1)}`}/>
      {([1, 2] as const).map(index => <circle key={index} className="geometry-editor__handle" cx={curve[`x${index}`] * 100} cy={y(curve[`y${index}`])} r="2" role="button" aria-label={`Drag Bezier handle ${index}`} onPointerDown={event => {if(!disabled) begin(event, point => ({...curve, [`x${index}`]: point.x / 100, [`y${index}`]: high - point.y / 100 * (high - low)}), setDraft, onChange);}}/>)}
    </svg>
    <div className="field-row"><NumberField label="Start handle X" value={value.x1} max={1} step={.05} disabled={disabled} onCommit={x1 => onChange({...value, x1})}/><NumberField label="Start handle Y" value={value.y1} min={-999999} step={.05} disabled={disabled} onCommit={y1 => onChange({...value, y1})}/></div>
    <div className="field-row"><NumberField label="End handle X" value={value.x2} max={1} step={.05} disabled={disabled} onCommit={x2 => onChange({...value, x2})}/><NumberField label="End handle Y" value={value.y2} min={-999999} step={.05} disabled={disabled} onCommit={y2 => onChange({...value, y2})}/></div>
  </div>;
}
