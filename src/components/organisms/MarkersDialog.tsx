import {useState} from 'react';
import {formatTimecode} from '../../../shared/project';
import {useEditor} from '../../stores/editor-store';
import {addTimelineMarker} from '../../services/organization-actions';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {MarkerEditor} from '../molecules/MarkerEditor';
export function MarkersDialog({initialId, onClose}: {initialId?: string; onClose: () => void}) {
  const project = useEditor(s => s.snapshot?.project); const busy = useEditor(s => s.busy); const error = useEditor(s => s.error);
  const [selected, setSelected] = useState(initialId); const [query, setQuery] = useState('');
  const marker = project?.markers?.find(m => m.id === selected);
  return <Dialog title="Timeline markers" onClose={onClose}><div className="organization-dialog">
    <div className="organization-actions"><Button disabled={busy} onClick={() => void addTimelineMarker().then(id => {if(id) setSelected(id);})}>Add marker at playhead</Button><span>M: add · Shift+M: next · Ctrl+Shift+M: previous</span></div>
    <input aria-label="Search markers" placeholder="Search marker names or notes…" value={query} onChange={e => setQuery(e.target.value)}/>
    {error && <p role="alert" className="agent-inline-error">{error}</p>}
    <div className="organization-list">{project?.markers?.filter(m => `${m.name} ${m.note}`.toLowerCase().includes(query.toLowerCase())).map(m => <div key={m.id}>
      <button aria-pressed={selected === m.id} onClick={() => setSelected(m.id)}><i style={{background: m.color}}/>{m.name}<small>{formatTimecode(m.frame, project.fps)}{m.end != null ? ` – ${formatTimecode(m.end, project.fps)}` : ''}</small></button>
      <Button onClick={() => useEditor.getState().seekTo(m.frame)}>Go to</Button>
    </div>)}</div>
    {!project?.markers?.length && <p>Add markers to label moments or ranges and leave editing notes.</p>}
    {marker && <MarkerEditor key={JSON.stringify(marker)} marker={marker} fps={project!.fps}/>}
  </div></Dialog>;
}
