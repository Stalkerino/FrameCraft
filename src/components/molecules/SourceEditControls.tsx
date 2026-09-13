import {useState, type RefObject} from 'react';
import {clipSchema, type Asset} from '../../../shared/project';
import {acceptsClip, projectTracks} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {createId} from '../../services/id-service';
import {Field} from '../atoms/Field';
import {Button} from '../atoms/Button';

export function SourceEditControls({asset, media}: {asset: Asset; media: RefObject<HTMLMediaElement | null>}) {
  const [start, setStart] = useState(0); const [end, setEnd] = useState(asset.duration); const busy = useEditor(s => s.busy);
  const insert = async (mode: 'insert' | 'overwrite') => {
    const state = useEditor.getState(); const project = state.snapshot?.project; if(!project || busy) return;
    if(!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > asset.duration) {useEditor.setState({error: 'Choose source In/Out points inside the media duration.'}); return;}
    const first = Math.round(start * project.fps); const last = Math.min(Math.floor(asset.duration * project.fps), Math.round(end * project.fps));
    if(last <= first) {useEditor.setState({error: 'Source Out must follow In.'}); return;}
    const tracks = projectTracks(project);
    const mediaType = {kind: asset.kind, track: asset.kind === 'audio' ? 'audio' as const : 'visual' as const};
    const track = tracks.find(t => t.id === state.selectedTrackId && acceptsClip(t, mediaType)) ?? tracks.find(t => acceptsClip(t, mediaType));
    if(!track) {useEditor.setState({error: 'Add a compatible track first.'}); return;}
    const clip = clipSchema.parse({id: createId(), name: asset.name, assetId: asset.id, kind: asset.kind, track: track.type, trackId: track.id,
      start: state.frame, sourceStart: first, duration: last - first});
    await state.execute([{type: 'timeline.place', clip, mode}], `${mode === 'insert' ? 'Inserted' : 'Overwrote with'} source selection`, project.revision);
  };
  return <div className="source-edit-controls">
    <Field label="Source In (seconds)"><input type="number" min={0} max={asset.duration} step="any" value={start} onChange={e => setStart(Number(e.target.value))}/></Field>
    <Field label="Source Out (seconds)"><input type="number" min={0} max={asset.duration} step="any" value={end} onChange={e => setEnd(Number(e.target.value))}/></Field>
    <Button onClick={() => setStart(media.current?.currentTime ?? 0)}>Mark In</Button><Button onClick={() => setEnd(media.current?.currentTime ?? asset.duration)}>Mark Out</Button>
    <Button disabled={busy || end <= start} onClick={() => void insert('insert')}>Insert at playhead</Button><Button disabled={busy || end <= start} onClick={() => void insert('overwrite')}>Overwrite</Button>
  </div>;
}
