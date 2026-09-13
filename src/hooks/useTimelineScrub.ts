import {useEffect, useRef, type PointerEvent} from 'react';

/** Shared pointer lifecycle for both the ruler and the playhead handle. */
export function useTimelineScrub(seek: (clientX: number) => void) {
  const drag = useRef<{id: number; element: HTMLElement} | null>(null);
  const finish = () => {
    const current = drag.current; drag.current = null;
    document.body.classList.remove('timeline-scrubbing');
    if(current?.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
  };
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => {window.removeEventListener('blur', finish); finish();};
  }, []);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if(event.button !== 0) return;
      event.preventDefault();
      drag.current = {id: event.pointerId, element: event.currentTarget};
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add('timeline-scrubbing');
      window.getSelection()?.removeAllRanges();
      seek(event.clientX);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if(drag.current?.id !== event.pointerId) return;
      event.preventDefault(); seek(event.clientX);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if(drag.current?.id !== event.pointerId) return;
      event.preventDefault(); seek(event.clientX); finish();
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };
}
