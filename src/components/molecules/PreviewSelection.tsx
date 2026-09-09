import type {PointerEvent} from 'react';
import {LockKeyhole} from 'lucide-react';
import type {Project} from '../../../shared/project';
import type {Corner, Rect} from '../../services/preview-geometry-service';
import {useEditor} from '../../stores/editor-store';
export function PreviewSelection({project, bounds, begin}: {project: Project; bounds: {id: string; rect: Rect}[]; begin: (event: PointerEvent, id: string, corner?: Corner) => void}) {
  const selectedId = useEditor(s => s.selectedId); const busy = useEditor(s => s.busy);
  const selected = bounds.find(b => b.id === selectedId); const selectedClip = project.clips.find(c => c.id === selectedId); const name = selectedClip?.name;
  return <div className="preview-selection" aria-label="Canvas editing controls">
    {bounds.map(({id, rect}) => <button key={id} aria-label={`${project.clips.find(c => c.id === id)?.positionLocked ? 'Select' : 'Move'} ${project.clips.find(c => c.id === id)?.name} on canvas`} disabled={busy} className={`preview-selection__hit ${project.clips.find(c => c.id === id)?.positionLocked ? 'preview-selection__hit--locked' : ''}`} style={rect} onPointerDown={event => begin(event, id)} onFocus={() => useEditor.setState({selectedId: id})} onKeyDown={event => {
      if(!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const clip = useEditor.getState().snapshot?.project.clips.find(c => c.id === id); if(!clip || clip.positionLocked) return;
      const step = event.shiftKey ? 10 : 1; const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'; const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      void useEditor.getState().updateClip(id, horizontal ? {x: Math.min(100, Math.max(0, clip.x + sign * step / project.width * 100))} : {y: Math.min(100, Math.max(0, clip.y + sign * step / project.height * 100))}, 'Nudged element on canvas');
    }}/>) }
    {selected && <div className={`preview-selection__box ${selectedClip?.positionLocked ? 'preview-selection__box--locked' : ''}`} style={selected.rect}><span className="preview-selection__name">{selectedClip?.positionLocked && <LockKeyhole size={10}/>} {name}</span>{(['nw', 'ne', 'sw', 'se'] as const).map(corner => <button key={corner} className={`preview-selection__handle preview-selection__handle--${corner}`} aria-label={`Resize ${name} ${corner}`} disabled={busy} onPointerDown={event => begin(event, selected.id, corner)}/>)}</div>}
  </div>;
}
