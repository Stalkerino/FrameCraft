import {useEditor} from '../stores/editor-store';
import {timelineSelection} from './timeline-selection';
import {createId} from './id-service';
export function setClipRelationship(kind: 'group' | 'link', clear = false) {
  const state = useEditor.getState(); const ids = timelineSelection(state);
  if(!ids.length || state.busy) return;
  void state.execute([kind === 'group' ? {type: 'clips.group', ids, groupId: clear ? null : createId()} : {type: 'clips.link', ids, linkId: clear ? null : createId()}], `${clear ? 'Removed' : 'Created'} clip ${kind}`);
}
export function rippleDeleteSelection() {
  const state = useEditor.getState(); const ids = timelineSelection(state);
  if(ids.length && !state.busy) void state.execute([{type: 'timeline.ripple-delete', ids}], 'Ripple deleted selected time across all tracks');
}
