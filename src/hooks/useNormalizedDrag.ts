import {useEffect, useRef, type PointerEvent, type RefObject} from 'react';
export interface NormalizedPoint {x: number; y: number}

/** Shared pointer lifecycle for geometry and curve editors; one commit on release. */
export function useNormalizedDrag(svg: RefObject<SVGSVGElement | null>, revision: unknown) {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => {cancel.current?.(); return () => cancel.current?.();}, [revision]);
  return function begin<T>(event: PointerEvent, transform: (point: NormalizedPoint, start: NormalizedPoint) => T, preview: (value: T | null) => void, commit: (value: T) => void) {
    if(event.button !== 0 || !svg.current) return;
    event.preventDefault(); event.stopPropagation(); cancel.current?.();
    const bounds = svg.current.getBoundingClientRect(); const pointerId = event.pointerId;
    const point = (x: number, y: number) => ({x: Math.max(0, Math.min(100, (x - bounds.left) / bounds.width * 100)), y: Math.max(0, Math.min(100, (y - bounds.top) / bounds.height * 100))});
    const start = point(event.clientX, event.clientY); const startX = event.clientX; const startY = event.clientY;
    let latest: T | null = null;
    const move = (next: globalThis.PointerEvent) => {
      if(next.pointerId !== pointerId || (!latest && Math.hypot(next.clientX - startX, next.clientY - startY) < 3)) return;
      latest = transform(point(next.clientX, next.clientY), start); preview(latest);
    };
    const cleanup = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', abort); window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', abort); cancel.current = null;};
    const abort = () => {cleanup(); preview(null);};
    const end = (next: globalThis.PointerEvent) => {if(next.pointerId !== pointerId) return; cleanup(); if(latest !== null) commit(latest); preview(null);};
    const escape = (next: KeyboardEvent) => {if(next.key === 'Escape') {next.preventDefault(); next.stopPropagation(); abort();}};
    cancel.current = abort;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', abort); window.addEventListener('keydown', escape, true); window.addEventListener('blur', abort);
  };
}
