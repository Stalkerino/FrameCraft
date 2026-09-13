import {useState} from 'react';
import type {TimelineMarker} from '../../../shared/project-organization';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function MarkerEditor({marker, fps}: {marker: TimelineMarker; fps: number}) {
  const [draft, setDraft] = useState(marker); const busy = useEditor(s => s.busy);
  return <form className="marker-editor" onSubmit={e => {e.preventDefault(); void useEditor.getState().execute([{type: 'marker.set', marker: draft}], 'Updated timeline marker');}}>
    <Field label="Marker name"><input required maxLength={120} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></Field>
    <div className="field-row"><Field label="Marker start (seconds)"><input type="number" min={0} step={1 / fps} required value={draft.frame / fps} onChange={e => setDraft({...draft, frame: Math.round(Number(e.target.value) * fps)})}/></Field>
      <Field label="Marker color"><input type="color" value={draft.color} onChange={e => setDraft({...draft, color: e.target.value})}/></Field></div>
    <label><input type="checkbox" checked={draft.end != null} onChange={e => setDraft({...draft, end: e.target.checked ? draft.frame + Math.round(fps) : null})}/> Range marker</label>
    {draft.end != null && <Field label="Marker end (seconds)"><input type="number" min={(draft.frame + 1) / fps} step={1 / fps} required value={draft.end / fps} onChange={e => setDraft({...draft, end: Math.round(Number(e.target.value) * fps)})}/></Field>}
    <Field label="Marker notes"><textarea rows={3} maxLength={2000} value={draft.note} onChange={e => setDraft({...draft, note: e.target.value})}/></Field>
    <div className="organization-actions"><Button type="submit" variant="primary" disabled={busy || !draft.name.trim() || draft.end != null && draft.end <= draft.frame}>Save marker</Button>
      <Button type="button" disabled={busy} onClick={() => void useEditor.getState().execute([{type: 'marker.remove', id: marker.id}], 'Removed timeline marker')}>Delete marker</Button></div>
  </form>;
}
