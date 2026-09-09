import {useEffect, type RefObject} from 'react';
export function useDismissableLayer(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if(!open) return;
    const outside = (event: PointerEvent) => {if(!ref.current?.contains(event.target as Node)) onClose();};
    const escape = (event: KeyboardEvent) => {if(event.key === 'Escape') {event.preventDefault(); onClose();}};
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, [ref, open, onClose]);
}
