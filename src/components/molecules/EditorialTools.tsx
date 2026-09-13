import {useEditor} from '../../stores/editor-store';
import {timelineSelection} from '../../services/timeline-selection';
import {rippleDeleteSelection, setClipRelationship} from '../../services/editorial-actions';
export function EditorialTools() {
  const state = useEditor(); const ids = timelineSelection(state);
  const selected = state.snapshot?.project.clips.filter(c => ids.includes(c.id)) ?? [];
  return <div className="timeline-tool-group editorial-tools" role="group" aria-label="Advanced timeline editing">
    <select aria-label="Trim mode" title="Trim: clip edges · Ripple/Roll: right edge · Slip: clip body" value={state.trimMode} onChange={event => useEditor.setState({trimMode: event.target.value as typeof state.trimMode, timelineTool: 'select'})}>
      <option value="trim">Trim</option><option value="ripple">Ripple trim</option><option value="roll">Roll edit</option><option value="slip">Slip edit</option>
    </select>
    <details className="editorial-tools__menu"><summary>Actions</summary><div onClick={event => {if((event.target as HTMLElement).closest('button')) event.currentTarget.closest('details')?.removeAttribute('open');}}>
      <button disabled={state.busy || ids.length < 2 && !selected.some(c => c.groupId)} onClick={() => setClipRelationship('group', selected.some(c => !!c.groupId))}>{selected.some(c => c.groupId) ? 'Ungroup' : 'Group'} <kbd>Ctrl+G</kbd></button>
      <button disabled={state.busy || ids.length < 2 && !selected.some(c => c.linkId)} onClick={() => setClipRelationship('link', selected.some(c => !!c.linkId))}>{selected.some(c => c.linkId) ? 'Unlink' : 'Link'}</button>
      <button title="Remove selected time across all tracks and close the gap" disabled={state.busy || !ids.length} onClick={rippleDeleteSelection}>Ripple delete <kbd>Shift+Del</kbd></button>
      <button title="Close an empty gap across all tracks at the playhead" disabled={state.busy} onClick={() => void state.execute([{type: 'timeline.close-gap', frame: state.frame}], 'Closed timeline gap')}>Close gap at playhead</button>
    </div></details>
  </div>;
}
