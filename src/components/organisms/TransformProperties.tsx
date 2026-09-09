import {LockKeyhole} from 'lucide-react';
import type {Clip} from '../../../shared/project';
import {useVisualEditing} from '../../hooks/useVisualEditing';
import {useEditor} from '../../stores/editor-store';
import {NumberField} from '../atoms/Field';
import {PropertySection} from '../atoms/PropertySection';

export function TransformProperties({clip}: {clip: Clip}) {
  const editing = useVisualEditing(clip); const value = editing.value;
  const disabled = (property: keyof typeof value) => editing.busy || ((property === 'x' || property === 'y') && clip.positionLocked) || (!editing.inside && Boolean(clip.keyframes?.[property]?.length));
  return <PropertySection title="Transform" summary={clip.positionLocked ? 'Position locked' : `${Math.round(value.scale * 100)}%`}>
    <label className="position-lock"><LockKeyhole size={13}/><span>Lock position</span><input type="checkbox" role="switch" aria-label="Lock position" checked={clip.positionLocked} disabled={editing.busy} onChange={event => void useEditor.getState().updateClip(clip.id, {positionLocked: event.target.checked}, event.target.checked ? 'Locked element position' : 'Unlocked element position')}/></label>
    <div className="field-row"><NumberField label="Position X" value={value.x} max={100} step={.5} suffix="%" disabled={disabled('x')} onCommit={x => editing.update({x})}/><NumberField label="Position Y" value={value.y} max={100} step={.5} suffix="%" disabled={disabled('y')} onCommit={y => editing.update({y})}/></div>
    <div className="field-row"><NumberField label="Scale" value={Math.round(value.scale * 100)} min={10} max={400} suffix="%" disabled={disabled('scale')} onCommit={scale => editing.update({scale: scale / 100})}/><NumberField label="Rotation" value={value.rotation} min={-36000} max={36000} suffix="°" disabled={disabled('rotation')} onCommit={rotation => editing.update({rotation})}/></div>
    <NumberField label="Opacity" value={Math.round(value.opacity * 100)} max={100} suffix="%" disabled={disabled('opacity')} onCommit={opacity => editing.update({opacity: opacity / 100})}/>
    <p className="field-help">Drag in the preview to move or resize. Animated properties update a key at the playhead; position locks protect X/Y.</p>
  </PropertySection>;
}
