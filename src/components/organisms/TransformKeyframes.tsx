import {Crosshair, Plus, Trash2} from 'lucide-react';
import {useState} from 'react';
import {ZodError} from 'zod';
import type {Clip, Project} from '../../../shared/project';
import {easingNames, upsertVisualKeyframe, visualKeyframesSchema, visualProperties, visualPropertyLimits, type VisualKeyframe, type VisualProperty} from '../../../shared/visual-editing';
import {useVisualEditing} from '../../hooks/useVisualEditing';
import {useEditor} from '../../stores/editor-store';
import {Button, IconButton} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';
import {PropertySection} from '../atoms/PropertySection';
import {AnimationCurveEditor} from '../molecules/AnimationCurveEditor';
import {BezierEditor} from '../molecules/BezierEditor';

const names: Record<VisualProperty, string> = {x: 'Position X', y: 'Position Y', scale: 'Scale', rotation: 'Rotation', opacity: 'Opacity'};
export function TransformKeyframes({clip, project}: {clip: Clip; project: Project}) {
  const [property, setProperty] = useState<VisualProperty>('x'); const [selectedFrame, setSelectedFrame] = useState<number | null>(null); const [error, setError] = useState('');
  const editing = useVisualEditing(clip); const keys = clip.keyframes?.[property] ?? []; const offset = clip.motionOffset ?? 0;
  const selected = keys.find(key => key.frame === selectedFrame) ?? keys[0];
  const locked = clip.positionLocked && (property === 'x' || property === 'y'); const disabled = editing.busy || locked;
  const [min, max] = visualPropertyLimits[property]; const unit = property === 'rotation' ? '°' : property === 'scale' ? '×' : '%'; const factor = property === 'opacity' ? 100 : 1;
  const save = (next: VisualKeyframe[]) => {
    try {setError(''); const keyframes = visualKeyframesSchema.parse({...clip.keyframes, [property]: next}); void useEditor.getState().updateClip(clip.id, {keyframes}, `Changed ${names[property]} animation`);}
    catch(error) {setError(error instanceof ZodError ? error.issues[0].message : (error as Error).message);}
  };
  const update = (key: VisualKeyframe, change: Partial<VisualKeyframe>) => {
    const next = {...key, ...change}; save(keys.map(previous => previous.frame === key.frame ? next : previous).sort((a, b) => a.frame - b.frame)); setSelectedFrame(next.frame);
  };
  const count = visualProperties.reduce((total, property) => total + (clip.keyframes?.[property]?.length ?? 0), 0);
  return <PropertySection title="Transform keyframes" defaultOpen={false} summary={count ? `${count} keys` : 'Static'}>
    <Field label="Animated property"><select aria-label="Animated property" value={property} onChange={event => {setProperty(event.target.value as VisualProperty); setSelectedFrame(null); setError('');}}>{visualProperties.map(property => <option key={property} value={property}>{names[property]}</option>)}</select></Field>
    <AnimationCurveEditor key={property} clip={clip} property={property} localFrame={editing.localFrame} selectedFrame={selected?.frame ?? null} disabled={disabled} onSelect={setSelectedFrame} onCommit={save}/>
    <div className="geometry-actions"><Button type="button" icon={<Plus size={12}/>} disabled={disabled || !editing.inside || editing.localFrame + offset < 0} onClick={() => {
      const frame = editing.localFrame + offset; const existing = keys.find(key => key.frame === frame);
      const next = upsertVisualKeyframe(clip.keyframes, property, {...existing, frame, value: editing.value[property], easing: existing?.easing ?? 'linear'});
      save(next[property]!); setSelectedFrame(frame);
    }}>Add key at playhead</Button>{keys.length > 0 && <Button type="button" disabled={disabled} onClick={() => {const keyframes = {...clip.keyframes}; delete keyframes[property]; void useEditor.getState().updateClip(clip.id, {[property]: editing.value[property], keyframes: Object.keys(keyframes).length ? keyframes : null}, `Removed ${names[property]} animation`);}}>Remove animation</Button>}</div>
    {!editing.inside && <p className="field-help">Place the playhead inside this clip to add a key.</p>}
    {editing.inside && editing.localFrame + offset < 0 && <p className="field-help">This extended fragment begins before its original animation clock. Move the playhead to {(-offset / project.fps).toFixed(2)} s into this clip to add a key.</p>}
    {locked && <p className="field-help">Unlock the clip’s position to edit X/Y animation.</p>}
    <div className="keyframe-list">{keys.map((key, index) => <div className={`keyframe-list__row ${selected?.frame === key.frame ? 'keyframe-list__row--selected' : ''}`} key={key.frame}>
      <button type="button" aria-label={`Select animation key ${index + 1}`} onClick={() => setSelectedFrame(key.frame)}>{index + 1}</button>
      <NumberField label={`Key ${index + 1} time`} value={(key.frame - offset) / project.fps} min={-offset / project.fps} step={1 / project.fps} suffix="s" disabled={disabled} onCommit={seconds => update(key, {frame: Math.round(seconds * project.fps) + offset})}/>
      <NumberField label={`Key ${index + 1} value`} value={key.value * factor} min={min * factor} max={max * factor} step={property === 'scale' ? .05 : 1} suffix={unit} disabled={disabled} onCommit={value => update(key, {value: value / factor})}/>
      <IconButton label={`Seek animation key ${index + 1}`} disabled={key.frame < offset || key.frame >= offset + clip.duration} onClick={() => {setSelectedFrame(key.frame); useEditor.getState().seekTo(clip.start + key.frame - offset);}}><Crosshair size={12}/></IconButton>
      <IconButton label={`Remove animation key ${index + 1}`} disabled={disabled} onClick={() => save(keys.filter(previous => previous.frame !== key.frame))}><Trash2 size={12}/></IconButton>
    </div>)}</div>
    {selected && <>
      <Field label="Outgoing easing"><select aria-label="Outgoing easing" disabled={disabled} value={selected.easing} onChange={event => {const easing = event.target.value as VisualKeyframe['easing']; update(selected, {easing, ...(easing === 'bezier' ? {bezier: selected.bezier ?? {x1: .25, y1: .1, x2: .25, y2: 1}} : {})});}}>{easingNames.map(easing => <option key={easing} value={easing}>{easing === 'bezier' ? 'Custom Bézier' : easing.replaceAll('-', ' ')}</option>)}</select></Field>
      {selected.easing === 'bezier' && selected.bezier && <BezierEditor value={selected.bezier} disabled={disabled} onChange={bezier => update(selected, {bezier})}/>}
    </>}
    <p className="field-help">Use two or more keys to animate. Easing belongs to the selected key’s outgoing segment. Canvas dragging and Transform fields update animated properties at the playhead; keys outside trimmed fragments are preserved.</p>
    {error && <p className="geometry-error" role="alert">{error}</p>}
  </PropertySection>;
}
