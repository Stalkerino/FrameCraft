import {useEffect, useRef, useState, type PointerEvent, type RefObject} from 'react';
import {useEditor} from '../stores/editor-store';
import {intersects, timelineSelection} from '../services/timeline-selection';

export function useTimelineMarquee(scroll: RefObject<HTMLDivElement | null>, seek: (x: number) => void, revision?: number, projectId?: string) {
  const [rectangle, setRectangle] = useState<{left: number; top: number; width: number; height: number} | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), [revision, projectId]);
  const start = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    if(event.button !== 0 || useEditor.getState().busy || target.closest('[data-clip-id], button, input, .track-label, .timeline-ruler, .playhead')) return;
    const container = scroll.current; const content = container?.querySelector<HTMLElement>('.timeline-content');
    if(!container || !content) return;
    const bounds = container.getBoundingClientRect();
    if(event.clientX < bounds.left + 196) return;
    event.preventDefault();
    const previous = timelineSelection(useEditor.getState()); const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const origin = {x: event.clientX - content.getBoundingClientRect().left, y: event.clientY - content.getBoundingClientRect().top};
    const initial = {x: event.clientX, y: event.clientY}; let pointer = initial; let dragging = false; let raf = 0;
    const trackId = target.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
    useEditor.setState({playing: false});
    const draw = () => {
      if(!dragging) return;
      const box = content.getBoundingClientRect();
      const x = Math.max(196, pointer.x - box.left); const y = Math.max(30, pointer.y - box.top);
      const area = {left: Math.min(origin.x, x), right: Math.max(origin.x, x), top: Math.min(origin.y, y), bottom: Math.max(origin.y, y)};
      setRectangle({left: area.left, top: area.top, width: area.right - area.left, height: area.bottom - area.top});
      const ids = Array.from(content.querySelectorAll<HTMLElement>('[data-clip-id]')).filter(node => {
        const rect = node.getBoundingClientRect();
        return intersects(area, {left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top});
      }).map(node => node.dataset.clipId!);
      const selection = [...new Set([...(additive ? previous : []), ...ids])];
      useEditor.setState({selectedIds: selection, selectedId: selection[0] ?? null});
    };
    const tick = () => {
      if(dragging) {
        const rect = container.getBoundingClientRect();
        const speed = (point: number, low: number, high: number) => point < low + 28 ? -12 : point > high - 28 ? 12 : 0;
        const beforeX = container.scrollLeft; const beforeY = container.scrollTop;
        container.scrollLeft += speed(pointer.x, rect.left + 196, rect.right);
        container.scrollTop += speed(pointer.y, rect.top + 30, rect.bottom);
        if(beforeX !== container.scrollLeft || beforeY !== container.scrollTop) draw();
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== event.pointerId) return;
      pointer = {x: e.clientX, y: e.clientY};
      if(Math.hypot(pointer.x - initial.x, pointer.y - initial.y) >= 4) dragging = true;
      draw();
    };
    const stop = () => {
      cancelAnimationFrame(raf); setRectangle(null);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true);
      cleanup.current = null;
    };
    const up = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== event.pointerId) return;
      if(dragging) {pointer = {x: e.clientX, y: e.clientY}; draw();}
      else if(!additive) {useEditor.setState({selectedIds: [], selectedId: null, ...(trackId ? {selectedTrackId: trackId} : {})}); seek(e.clientX);}
      stop();
    };
    const cancel = (e?: globalThis.PointerEvent) => {if(e && e.pointerId !== event.pointerId) return; stop(); useEditor.setState({selectedIds: previous, selectedId: previous[0] ?? null});};
    const key = (e: KeyboardEvent) => {if(e.key === 'Escape') {e.preventDefault(); e.stopPropagation(); cancel();}};
    cleanup.current?.(); cleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true);
    raf = requestAnimationFrame(tick);
  };
  return {rectangle, start};
}
