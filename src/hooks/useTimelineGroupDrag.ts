import {useEffect, useRef, type PointerEvent} from 'react';
import {useEditor} from '../stores/editor-store';
import {groupMoveDelta, timelineSelection} from '../services/timeline-selection';
import {useWorkspace} from '../stores/workspace-store';

export function useTimelineGroupDrag() {
  const revision = useEditor(s => s.snapshot?.project.revision); const projectId = useEditor(s => s.snapshot?.project.id);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [revision, projectId]);
  return (event: PointerEvent, id: string, pixelsPerFrame: number) => {
    const state = useEditor.getState(); const project = state.snapshot?.project; const ids = timelineSelection(state);
    if(!project || !ids.includes(id) || ids.length < 2) return false;
    const clips = project.clips.filter(c => ids.includes(c.id)); const anchor = clips.find(c => c.id === id)!;
    const x = event.clientX; const container = event.currentTarget.closest('.timeline-scroll'); const scrollStart = container?.scrollLeft ?? 0;
    let delta = 0; let moved = false;
    useEditor.setState({playing: false});
    const move = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== event.pointerId) return;
      const distance = e.clientX - x + (container?.scrollLeft ?? 0) - scrollStart;
      if(!moved && Math.abs(distance) < 4) return;
      moved = true; delta = groupMoveDelta(clips, distance / pixelsPerFrame);
      if(useWorkspace.getState().snapping && !e.altKey) {
        const targets = [0, useEditor.getState().frame, ...project.clips.filter(c => !ids.includes(c.id)).flatMap(c => [c.start, c.start + c.duration])];
        for(const target of targets) {
          const edge = [anchor.start, anchor.start + anchor.duration].find(edge => Math.abs(edge + delta - target) * pixelsPerFrame < 7);
          if(edge !== undefined) {delta = groupMoveDelta(clips, target - edge); break;}
        }
      }
      useEditor.setState({groupDrag: {ids, delta}});
    };
    const stop = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); cleanup.current = null; useEditor.setState({groupDrag: null});};
    const up = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== event.pointerId) return;
      move(e); stop();
      if(moved && delta) void state.execute(clips.map(c => ({type: 'clip.update', id: c.id, patch: {start: c.start + delta}})), `Moved ${clips.length} clips`, project.revision);
    };
    const cancel = (e?: globalThis.PointerEvent) => {if(!e || e.pointerId === event.pointerId) stop();};
    const key = (e: KeyboardEvent) => {if(e.key === 'Escape') {e.preventDefault(); e.stopPropagation(); stop();}};
    cleanup.current?.(); cleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true);
    return true;
  };
}
