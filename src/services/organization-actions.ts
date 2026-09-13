import {useEditor} from '../stores/editor-store';
import {createId} from './id-service';
export async function addTimelineMarker() {
  const state = useEditor.getState(); if(!state.snapshot || state.busy) return;
  const id = createId();
  const ok = await state.execute([{type: 'marker.set', marker: {id, name: `Marker ${(state.snapshot.project.markers?.length ?? 0) + 1}`, frame: state.frame, color: '#e9b76b', note: ''}}], 'Added timeline marker');
  return ok ? id : undefined;
}
export function jumpTimelineMarker(direction: -1 | 1) {
  const state = useEditor.getState(); const frames = (state.snapshot?.project.markers ?? []).map(m => m.frame).sort((a, b) => a - b);
  const frame = direction === 1 ? frames.find(f => f > state.frame) : [...frames].reverse().find(f => f < state.frame);
  if(frame !== undefined) state.seekTo(frame);
}
export function moveMediaToFolder(ids: string[], folderId: string | null) {
  const state = useEditor.getState(); if(state.busy) return;
  return state.execute([{type: 'assets.move-folder', ids, folderId}], 'Moved media to folder');
}
