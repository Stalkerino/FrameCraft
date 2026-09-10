import {useState} from 'react';
import {ArrowDown, ArrowUp, Play} from 'lucide-react';
import type {Asset, Project} from '../../../shared/project';
import {projectTracks} from '../../../shared/tracks';
import {sourceTimecode, type VideoCut} from '../../../shared/visual-rush';
import {useEditor} from '../../stores/editor-store';
import {useAssistAction} from '../../hooks/use-assist-action';
import {visualRushApi} from '../../services/visual-rush-api';
import {Field} from '../atoms/Field';
import {Button, IconButton} from '../atoms/Button';
import {SourcePreview} from './SourcePreview';
export function VideoCutReview({cut, project, asset}: {cut: VideoCut; project: Project; asset: Asset}) {
  const [ids, setIds] = useState(cut.shots.map(shot => shot.id)); const [preview, setPreview] = useState<string | null>(null); const [applied, setApplied] = useState(false);
  const tracks = projectTracks(project).filter(track => track.type === 'visual'); const [trackId, setTrackId] = useState(tracks[0]?.id ?? ''); const [mode, setMode] = useState<'append' | 'replace-track'>('append'); const {busy, run} = useAssistAction();
  const [order, setOrder] = useState(cut.shots.map(shot => shot.id)); const selected = cut.shots.find(shot => shot.id === preview);
  return <div className="gameplay-review"><div className="assist-section-title"><strong>{cut.title}</strong><span className="match-badge">CODEX PROPOSAL</span></div><p className="field-help">{ids.length} shots · {Math.round(cut.shots.filter(shot => ids.includes(shot.id)).reduce((sum, shot) => sum + shot.end - shot.start, 0))} seconds selected</p>{selected && <SourcePreview asset={asset} start={selected.start} end={selected.end} seekKey={selected.id}/>}
    <ol className="roughcut-shots">{order.map((id, index) => {const shot = cut.shots.find(shot => shot.id === id)!; return <li key={id}><input aria-label={`Keep shot ${index + 1}`} type="checkbox" checked={ids.includes(id)} onChange={event => setIds(event.target.checked ? [...ids, id] : ids.filter(value => value !== id))}/><div><strong>{sourceTimecode(shot.start)} → {sourceTimecode(shot.end)}</strong><p>{shot.reason}</p><small>{shot.confidence} confidence · source footage</small><div className="shot-actions"><IconButton label={`Preview shot ${index + 1}`} onClick={() => setPreview(id)}><Play size={13}/></IconButton>{([-1, 1] as const).map(offset => <IconButton key={offset} label={`Move shot ${index + 1} ${offset < 0 ? 'up' : 'down'}`} disabled={index + offset < 0 || index + offset >= order.length} onClick={() => {const next = [...order]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setOrder(next);}}>{offset < 0 ? <ArrowUp size={13}/> : <ArrowDown size={13}/>}</IconButton>)}</div></div></li>;})}</ol>
    <Field label="Destination video track"><select aria-label="Cut destination track" value={trackId} onChange={event => setTrackId(event.target.value)}>{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field><Field label="Apply cut"><select aria-label="Cut apply mode" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="append">Append to this track</option><option value="replace-track">Replace clips on this track</option></select></Field>{mode === 'replace-track' && <p className="field-help">Replaces clips on the chosen video track. Other tracks keep their current timing.</p>}<Button variant="primary" disabled={busy || applied || !ids.length || !tracks.some(track => track.id === trackId)} onClick={() => void run(async () => {useEditor.getState().accept(await visualRushApi.apply({id: cut.id, version: cut.version, revision: project.revision, mode, trackId, shotIds: order.filter(id => ids.includes(id))})); setApplied(true);})}>{applied ? 'Cut applied · Undo available' : 'Apply cut'}</Button>
  </div>;
}
