import {ChevronRight} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';

export function PropertySection({title, summary, defaultOpen = true, children}: {title: string; summary?: string; defaultOpen?: boolean; children: ReactNode}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return <details className="property-section property-section--collapsible" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={13}/><h4>{title}</h4>{summary && <span>{summary}</span>}</summary>
    <div className="property-section__body">{children}</div>
  </details>;
}
