import {useRef} from 'react';

interface Props {label: string; orientation: 'horizontal' | 'vertical'; value: number; min: number; max: number; direction?: 1 | -1; onResize: (value: number) => void; onCommit: () => void}
export function ResizeHandle({label, orientation, value, min, max, direction = 1, onResize, onCommit}: Props) {
  const drag = useRef<{position: number; value: number} | null>(null);
  const limit = (next: number) => Math.max(min, Math.min(max, next));
  return <div className={`workspace-resize workspace-resize--${orientation}`} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={Math.round(max)}
    onPointerDown={event => {if(event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({preventScroll: true}); drag.current = {position: orientation === 'vertical' ? event.clientX : event.clientY, value}; event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event => {if(!drag.current) return; const position = orientation === 'vertical' ? event.clientX : event.clientY; onResize(limit(drag.current.value + (position - drag.current.position) * direction));}}
    onPointerUp={event => {if(!drag.current) return; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); onCommit();}}
    onPointerCancel={() => {if(drag.current) onResize(drag.current.value); drag.current = null; onCommit();}}
    onKeyDown={event => {
      const negative = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'; const positive = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      if(event.key !== negative && event.key !== positive) return;
      event.preventDefault(); event.stopPropagation(); onResize(limit(value + (event.key === positive ? 1 : -1) * direction * (event.shiftKey ? 40 : 16))); onCommit();
    }}><span/></div>;
}
