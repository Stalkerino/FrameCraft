import {useEffect} from 'react';
import {durationOf} from '../../shared/project';
import {useEditor} from '../stores/editor-store';
import {useWorkspace} from '../stores/workspace-store';
export function useEditorKeyboard() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if(event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if(target && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"]'))) return;
      const state = useEditor.getState(); const project = state.snapshot?.project; if(!project) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if(modifier && !event.altKey && key === 'c' && state.selectedId && !window.getSelection()?.toString()) {event.preventDefault(); state.copyClip();}
      else if(modifier && !event.altKey && key === 'v' && state.clipboard) {event.preventDefault(); if(!event.repeat && !state.busy) void state.pasteClip();}
      else if(modifier && !event.altKey && key === 'd' && state.selectedId) {event.preventDefault(); if(!event.repeat && !state.busy) void state.duplicateClip();}
      else if(modifier && key === 'z') {event.preventDefault(); if(!state.busy) void state.history(event.shiftKey ? 'redo' : 'undo');}
      else if(modifier && key === 'y') {event.preventDefault(); if(!state.busy) void state.history('redo');}
      else if(modifier && event.key.toLowerCase() === 's') {event.preventDefault(); useEditor.setState({notice: 'Your project is saved automatically on this device.'});}
      else if(event.code === 'Space' && !target?.closest('button')) {event.preventDefault(); useEditor.setState({playing: !state.playing});}
      else if((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !target?.closest('button')) {event.preventDefault(); state.seekTo(Math.max(0, Math.min(durationOf(project) - 1, state.frame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? Math.round(project.fps) : 1))));}
      else if((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) {event.preventDefault(); if(!state.busy) void state.execute([{type: 'clip.remove', id: state.selectedId}], 'Removed selected clip');}
      else if(!modifier && !event.altKey && event.key.toLowerCase() === 's') {event.preventDefault(); if(!event.repeat) void state.splitClip();}
      else if(!modifier && !event.altKey && event.key.toLowerCase() === 'n') {event.preventDefault(); if(!event.repeat) useWorkspace.getState().configure({snapping: !useWorkspace.getState().snapping});}
      else if(!modifier && !event.altKey && ['c', 'v'].includes(event.key.toLowerCase())) {event.preventDefault(); useEditor.setState({timelineTool: event.key.toLowerCase() === 'c' ? 'razor' : 'select'});}
      else if(event.key === 'Escape') useEditor.setState({selectedId: null, timelineTool: 'select'});
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
}
