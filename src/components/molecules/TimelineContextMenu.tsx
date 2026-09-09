import {useCallback, useEffect, useRef} from 'react';
import {ClipboardPaste, Copy, CopyPlus, Scissors, SlidersHorizontal, Trash2} from 'lucide-react';
import {useEditor} from '../../stores/editor-store';
import {canSplitAt} from '../../../shared/timeline-editing';
import {useDismissableLayer} from '../../hooks/useDismissableLayer';
import {openInspectorPanel} from '../../services/workspace-navigation';

export function TimelineContextMenu({clipId, x, y, onClose}: {clipId: string; x: number; y: number; onClose: () => void}) {
  const state = useEditor(); const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismissableLayer(ref, true, close);
  useEffect(() => {ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}, []);
  const clip = state.snapshot?.project.clips.find(c => c.id === clipId); if(!clip) return null;
  const run = (action: () => void) => {action(); onClose();};
  return <div className="timeline-context-menu" role="menu" aria-label="Clip actions" ref={ref} style={{left: Math.min(x, window.innerWidth - 260), top: Math.max(8, Math.min(y, window.innerHeight - 290))}} onKeyDown={event => {
    event.stopPropagation();
    if(event.key === 'Escape') {event.preventDefault(); onClose(); return;}
    if(!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>
    <p>{clip.name}</p>
    <button role="menuitem" onClick={() => run(() => {useEditor.setState({selectedId: clipId}); openInspectorPanel('properties');})}><SlidersHorizontal size={14}/>Clip properties</button>
    <button role="menuitem" onClick={() => run(state.copyClip)}><Copy size={14}/>Copy<kbd>Ctrl+C</kbd></button>
    <button role="menuitem" disabled={!state.clipboard || state.busy} onClick={() => run(() => void state.pasteClip())}><ClipboardPaste size={14}/>Paste at playhead<kbd>Ctrl+V</kbd></button>
    <button role="menuitem" disabled={state.busy} onClick={() => run(() => void state.duplicateClip())}><CopyPlus size={14}/>Duplicate<kbd>Ctrl+D</kbd></button>
    <button role="menuitem" disabled={state.busy || !canSplitAt(clip, state.frame)} onClick={() => run(() => void state.splitClip(clipId))}><Scissors size={14}/>Split at playhead<kbd>S</kbd></button>
    <button role="menuitem" className="timeline-context-menu__remove" disabled={state.busy} onClick={() => run(() => void state.execute([{type: 'clip.remove', id: clipId}], `Removed ${clip.name}`.slice(0, 180)))}><Trash2 size={14}/>Remove clip<kbd>Del</kbd></button>
  </div>;
}
