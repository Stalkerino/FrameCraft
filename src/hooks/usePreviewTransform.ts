import {useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject} from 'react';
import type {Project} from '../../shared/project';
import {measurePreview, moveOnCanvas, resizeOnCanvas, type Corner, type Rect, type TransformPatch} from '../services/preview-geometry-service';
import {useEditor} from '../stores/editor-store';

export function usePreviewTransform(canvas: RefObject<HTMLDivElement | null>, project: Project | undefined, frame: number, enabled: boolean) {
  const [draft, setDraft] = useState<{id: string; patch: TransformPatch} | null>(null);
  const [bounds, setBounds] = useState<{id: string; rect: Rect}[]>([]);
  const current = useRef({project, frame}); current.current = {project, frame};
  const cancelRef = useRef<(() => void) | null>(null); const gesture = useRef(0);
  useLayoutEffect(() => {
    if(!enabled) {setBounds([]); return;}
    let raf: number; let previous = '';
    const measure = () => {
      if(canvas.current && current.current.project) {
        const next = measurePreview(canvas.current, current.current.project, current.current.frame); const serialized = JSON.stringify(next);
        if(serialized !== previous) {previous = serialized; setBounds(next);}
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure); return () => cancelAnimationFrame(raf);
  }, [canvas, enabled]);
  useEffect(() => {cancelRef.current?.();}, [project?.revision, enabled]);
  useEffect(() => () => cancelRef.current?.(), []);
  const begin = (event: PointerEvent, id: string, corner?: Corner) => {
    if(event.button !== 0 || !enabled || useEditor.getState().busy || !project || !canvas.current) return;
    const clip = project.clips.find(c => c.id === id); const box = bounds.find(b => b.id === id)?.rect; if(!clip || !box) return;
    event.preventDefault(); event.stopPropagation(); cancelRef.current?.();
    useEditor.setState({selectedId: id, inspectorTab: 'properties', playing: false});
    if(clip.positionLocked && !corner) return;
    const canvasRect = canvas.current.getBoundingClientRect(); const x = event.clientX; const y = event.clientY; const pointer = event.pointerId; const revision = project.revision;
    const token = ++gesture.current; let latest: TransformPatch | null = null;
    const move = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== pointer) return;
      if(!latest && Math.hypot(e.clientX - x, e.clientY - y) < 4) return;
      latest = corner ? resizeOnCanvas(clip, box, canvasRect, corner, e.clientX - x, e.clientY - y) : moveOnCanvas(clip, e.clientX - x, e.clientY - y, canvasRect);
      if(clip.positionLocked) latest = {...latest, x: clip.x, y: clip.y};
      setDraft({id, patch: latest});
    };
    const cleanup = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('keydown', escape); cancelRef.current = null;};
    const cancel = () => {cleanup(); gesture.current++; setDraft(null);};
    const escape = (e: KeyboardEvent) => {if(e.key === 'Escape') {e.preventDefault(); cancel();}};
    const end = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== pointer) return; cleanup();
      if(latest && (latest.x !== clip.x || latest.y !== clip.y || latest.scale !== clip.scale)) {
        void useEditor.getState().execute([{type: 'clip.update', id, patch: latest}], `${corner ? 'Resized' : 'Moved'} ${clip.name} on canvas`, revision).finally(() => {if(gesture.current === token) setDraft(null);});
      } else setDraft(null);
    };
    cancelRef.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('keydown', escape);
  };
  return {draft, bounds, begin};
}
