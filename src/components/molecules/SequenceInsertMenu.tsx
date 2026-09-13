import {useEffect, useRef, useState} from 'react';
import {Layers3} from 'lucide-react';
import type {Project} from '../../../shared/project';
import {canNestSequence, sequenceSummaries} from '../../../shared/project-sequences';
import {insertSequence} from '../../services/sequence-actions';
import {Button} from '../atoms/Button';

/** Keep the drag source mounted until drop; native modal dialogs make the timeline inert. */
export function SequenceInsertMenu({project, busy}: {project: Project; busy: boolean}) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null);
  const candidates = sequenceSummaries(project).filter(sequence => canNestSequence(project, sequence.id));
  useEffect(() => {setOpen(false);}, [project.sequenceId]);
  useEffect(() => {
    if(!open) return;
    const close = (event: PointerEvent) => {if(!root.current?.contains(event.target as Node)) setOpen(false);};
    const escape = (event: KeyboardEvent) => {if(event.key === 'Escape') setOpen(false);};
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape);};
  }, [open]);
  if(!candidates.length) return null;
  return <div className="sequence-insert-menu" ref={root}>
    <Button variant="ghost" icon={<Layers3 size={13}/>} disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}>Insert sequence</Button>
    {open && <div className="sequence-insert-menu__items" aria-label="Insert nested sequence"><p>Click to insert at playhead, or drag onto a video track.</p>{candidates.map(sequence => <button type="button" key={sequence.id} draggable={!busy} disabled={busy}
      onDragStart={event => {event.dataTransfer.setData('application/framecraft-sequence', sequence.id); event.dataTransfer.effectAllowed = 'copy';}}
      onDragEnd={() => setOpen(false)} onClick={() => void insertSequence(sequence.id).then(ok => {if(ok) setOpen(false);})}>{sequence.name}<small>{sequence.durationSeconds.toFixed(1)} s · {sequence.fps} fps</small></button>)}</div>}
  </div>;
}
