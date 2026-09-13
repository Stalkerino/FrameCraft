import {ChevronLeft, ChevronRight, Copy, Plus, ClipboardPaste, Trash2, Undo2, Redo2} from 'lucide-react';
import type {Clip, Project} from '../../../shared/project';
import {easingNames, visualPropertyLimits, type VisualKeyframe} from '../../../shared/visual-editing';
import type {AnimationEditor} from '../../hooks/useAnimationEditor';
import {useEditor} from '../../stores/editor-store';
import {Button, IconButton} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';
import {BezierEditor} from './BezierEditor';

export function AnimationKeyControls({clip, project, editor}: {clip: Clip; project: Project; editor: AnimationEditor}) {
  const {property, keys, selected, disabled, offset} = editor;
  const snapshot = useEditor(state => state.snapshot);
  const key = keys.find(key => key.frame === selected[0]);
  const [min, max] = visualPropertyLimits[property]; const factor = property === 'opacity' ? 100 : 1;
  const unit = property === 'rotation' ? '°' : property === 'scale' ? '×' : '%';
  const mixed = selected.some(frame => keys.find(key => key.frame === frame)?.easing !== key?.easing);
  const ease = (easing: VisualKeyframe['easing'], bezier?: VisualKeyframe['bezier']) => void editor.commit([{action: 'ease', property, frames: selected, easing, bezier}], 'Changed animation easing');
  return <div className="animation-key-controls">
    <div className="animation-key-controls__toolbar">
      <IconButton label="Previous animation key" disabled={!keys.some(key => key.frame >= offset && key.frame < editor.frame)} onClick={() => editor.navigate(-1)}><ChevronLeft size={13}/></IconButton>
      <Button icon={<Plus size={12}/>} disabled={disabled || !editor.editing.inside || editor.frame < 0} onClick={() => void editor.add()}>Add key at playhead</Button>
      <IconButton label="Next animation key" disabled={!keys.some(key => key.frame > editor.frame && key.frame < offset + clip.duration)} onClick={() => editor.navigate(1)}><ChevronRight size={13}/></IconButton>
      <IconButton label="Copy animation keys (Ctrl+C)" disabled={!selected.length} onClick={editor.copy}><Copy size={13}/></IconButton>
      <IconButton label="Paste animation keys at playhead (Ctrl+V)" disabled={disabled || !editor.canPaste} onClick={() => void editor.paste()}><ClipboardPaste size={13}/></IconButton>
      <IconButton label="Delete selected animation keys" disabled={disabled || !selected.length} onClick={() => void editor.remove()}><Trash2 size={13}/></IconButton>
      <IconButton label="Undo animation edit (Ctrl+Z)" disabled={editor.editing.busy || !snapshot?.canUndo} onClick={() => editor.history('undo')}><Undo2 size={13}/></IconButton>
      <IconButton label="Redo animation edit (Ctrl+Shift+Z)" disabled={editor.editing.busy || !snapshot?.canRedo} onClick={() => editor.history('redo')}><Redo2 size={13}/></IconButton>
    </div>
    {key && selected.length === 1 && <div className="field-row">
      <NumberField label="Selected key frame" value={key.frame - offset} min={-offset} max={Number.MAX_SAFE_INTEGER - offset} precision={0} suffix="f" disabled={disabled} onCommit={frame => void editor.changeKey(key, {frame: Math.round(frame) + offset})}/>
      <NumberField label="Selected key value" value={key.value * factor} min={min * factor} max={max * factor} step={property === 'scale' ? .01 : 1} suffix={unit} disabled={disabled} onCommit={value => void editor.changeKey(key, {value: value / factor})}/>
    </div>}
    {!!selected.length && <>
      <Field label="Outgoing easing"><select aria-label="Outgoing easing" disabled={disabled} value={mixed ? '' : key!.easing} onChange={event => ease(event.target.value as VisualKeyframe['easing'])}>
        {mixed && <option value="" disabled>Mixed easing</option>}{easingNames.map(easing => <option key={easing} value={easing}>{easing === 'bezier' ? 'Custom Bézier' : easing.replaceAll('-', ' ')}</option>)}
      </select></Field>
      <div className="animation-key-controls__presets" aria-label="Easing presets">
        <button disabled={disabled} onClick={() => ease('linear')}>Linear</button><button disabled={disabled} onClick={() => ease('hold')}>Hold</button>
        <button disabled={disabled} onClick={() => ease('ease-in-out')}>Smooth</button><button disabled={disabled} onClick={() => ease('bezier', {x1: .34, y1: 1.56, x2: .64, y2: 1})}>Overshoot</button>
      </div>
      {key?.easing === 'bezier' && key.bezier && <BezierEditor value={key.bezier} disabled={disabled} onChange={bezier => ease('bezier', bezier)}/>}
    </>}
    <details className="animation-key-controls__list"><summary>All keys ({keys.length})</summary><div role="list" aria-label="Animation keys">{keys.map((key, index) => <button role="listitem" key={key.frame} className={selected.includes(key.frame) ? 'is-selected' : ''} aria-label={`Select animation key ${index + 1}`} onClick={event => editor.setSelection(event.shiftKey ? selected.includes(key.frame) ? selected.filter(frame => frame !== key.frame) : [...selected, key.frame] : [key.frame])} onDoubleClick={() => editor.seek(key.frame)}>
      <span>{key.frame - offset} f</span><span>{((key.frame - offset) / project.fps).toFixed(3)} s</span><span>{Number((key.value * factor).toFixed(2))}{unit}</span>{(key.frame < offset || key.frame >= offset + clip.duration) && <span>outside</span>}
    </button>)}</div></details>
    {!!keys.length && <Button disabled={disabled} onClick={() => void editor.commit([{action: 'clear', property, localFrame: editor.editing.localFrame}], 'Removed channel animation').then(ok => {if(ok) editor.setSelection([]);})}>Remove channel animation</Button>}
    <p className="field-help">Easing shapes the segment after each selected key. Paste starts at the playhead and replaces keys at matching frames. Remove channel keeps its current value.</p>
  </div>;
}
