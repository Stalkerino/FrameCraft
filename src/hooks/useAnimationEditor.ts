import {useState, type KeyboardEvent} from 'react';
import {create} from 'zustand';
import {copyAnimationKeys, pasteAnimationKeys, type AnimationClipboard, type AnimationEdit} from '../../shared/animation-editing';
import type {Clip, Project} from '../../shared/project';
import {visualProperties, type VisualKeyframe, type VisualProperty} from '../../shared/visual-editing';
import {editAnimation} from '../services/animation-actions';
import {useEditor} from '../stores/editor-store';
import {useVisualEditing} from './useVisualEditing';

const useClipboard = create<{value: AnimationClipboard | null}>(() => ({value: null}));
export function useAnimationEditor(clip: Clip, project: Project) {
  const [property, setProperty] = useState<VisualProperty>('x'); const [selection, setSelection] = useState<number[]>([]); const [error, setError] = useState('');
  const clipboard = useClipboard(state => state.value); const editing = useVisualEditing(clip);
  const keys = clip.keyframes?.[property] ?? []; const selected = selection.filter(frame => keys.some(key => key.frame === frame));
  const offset = clip.motionOffset ?? 0; const frame = editing.localFrame + offset;
  const locked = !!clip.positionLocked && (property === 'x' || property === 'y'); const disabled = editing.busy || locked;
  const commit = async (edits: AnimationEdit[], label = 'Edited animation keys') => {
    if(disabled) return false;
    try {setError(''); const ok = await editAnimation(project, clip, edits, label); if(!ok) setError(useEditor.getState().error ?? 'Animation edit could not be saved.'); return ok;}
    catch(error) {setError((error as Error).message); return false;}
  };
  const selectProperty = (next: VisualProperty) => {setProperty(next); setSelection([]); setError('');};
  const add = async (at = frame, value = editing.value[property]) => {
    if(at < 0) {setError('This part of the clip precedes its original animation clock. Add a key at frame 0 or later.'); return;}
    const existing = keys.find(key => key.frame === at);
    if(await commit([{action: 'upsert', property, keys: [{...existing, frame: at, value, easing: existing?.easing ?? 'linear'}]}], 'Added animation key')) setSelection([at]);
  };
  const remove = () => commit([{action: 'remove', property, frames: selected}], 'Deleted animation keys').then(ok => {if(ok) setSelection([]);});
  const copy = () => {const value = copyAnimationKeys(keys, selected, property, project.fps); if(value) useClipboard.setState({value});};
  const paste = async () => {
    if(!clipboard) return;
    try {
      const pasted = pasteAnimationKeys(clipboard, frame, project.fps, property);
      if(await commit([{action: 'upsert', property, keys: pasted}], 'Pasted animation keys')) setSelection(pasted.map(key => key.frame));
    } catch(error) {setError((error as Error).message);}
  };
  const changeKey = async (key: VisualKeyframe, change: Partial<VisualKeyframe>) => {
    const next = {...key, ...change};
    if(next.frame !== key.frame && keys.some(item => item.frame === next.frame)) {setError('Another key occupies that frame. Choose a free frame.'); return;}
    if(await commit([{action: 'remove', property, frames: [key.frame]}, {action: 'upsert', property, keys: [next]}])) setSelection([next.frame]);
  };
  const seek = (animationFrame: number) => useEditor.getState().seekTo(clip.start + animationFrame - offset);
  const navigate = (direction: -1 | 1) => {
    const visible = keys.filter(key => key.frame >= offset && key.frame < offset + clip.duration);
    const target = direction < 0 ? [...visible].reverse().find(key => key.frame < frame) : visible.find(key => key.frame > frame);
    if(target) {setSelection([target.frame]); seek(target.frame);}
  };
  // The editor queue serializes history behind an in-flight drag commit.
  const history = (direction: 'undo' | 'redo') => {setError(''); void useEditor.getState().history(direction);};
  const onKeyDown = (event: KeyboardEvent) => {
    if(event.isDefaultPrevented() || event.nativeEvent.isComposing || (event.target as Element).closest('input,textarea,select')) return;
    const key = event.key.toLowerCase(); const modifier = event.ctrlKey || event.metaKey;
    const handled = modifier && ['a', 'c', 'v', 'z', 'y'].includes(key) || ['delete', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'escape'].includes(key);
    if(!handled) return;
    event.preventDefault(); event.stopPropagation();
    if(key === 'escape') {setSelection([]); return;}
    if(modifier && key === 'a') setSelection(keys.map(key => key.frame));
    else if(modifier && key === 'c') copy();
    else if(modifier && key === 'z') history(event.shiftKey ? 'redo' : 'undo');
    else if(modifier && key === 'y') history('redo');
    else if(!disabled && !event.repeat) {
      if(modifier && key === 'v' && editing.inside) void paste();
      else if(selected.length && ['delete', 'backspace'].includes(key)) void remove();
      else if(selected.length && key.startsWith('arrow')) {
        const deltaFrame = key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0;
        const step = property === 'opacity' || property === 'scale' ? .01 : 1;
        const deltaValue = key === 'arrowup' ? step : key === 'arrowdown' ? -step : 0;
        const multiplier = event.shiftKey ? 10 : 1; const shift = Math.max(deltaFrame * multiplier, -Math.min(...selected));
        void commit([{action: 'move', property, frames: selected, deltaFrame: shift, deltaValue: deltaValue * multiplier}]).then(ok => {if(ok) setSelection(selected.map(at => at + shift));});
      }
    }
  };
  return {property, selectProperty, keys, selected, setSelection, error, setError, editing, locked, disabled, frame, offset, commit, add, remove, copy, paste, changeKey, seek, navigate, history, onKeyDown,
    canPaste: !!clipboard && clipboard.property === property && editing.inside && frame >= 0,
    count: visualProperties.reduce((count, channel) => count + (clip.keyframes?.[channel]?.length ?? 0), 0)};
}
export type AnimationEditor = ReturnType<typeof useAnimationEditor>;
