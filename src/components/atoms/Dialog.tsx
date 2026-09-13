import {useEffect, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';
import {IconButton} from './Button';
export function Dialog({title, children, onClose, className = ''}: {title: string; children: ReactNode; onClose: () => void; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {ref.current?.showModal();}, []);
  return <dialog ref={ref} className={`settings-dialog ${className}`} aria-label={title} onCancel={event => {event.preventDefault(); onClose();}} onKeyDown={event => event.stopPropagation()}><div className="settings-dialog__heading"><h2>{title}</h2><IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18}/></IconButton></div>{children}</dialog>;
}
