import {Plus, ListEnd} from 'lucide-react';
import {useState} from 'react';
import type {Asset} from '../../../shared/project';
import {formatTime} from '../../../shared/project';
import {projectTracks} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {openInspectorPanel} from '../../services/workspace-navigation';
import {Button} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';
import {Field} from '../atoms/Field';
import {SourcePreview} from './SourcePreview';

/** Inspect source media separately from the edited program, then choose its destination. */
export function MediaSourceDialog({asset, onClose}: {asset: Asset; onClose: () => void}) {
  const project = useEditor(s => s.snapshot?.project);
  const busy = useEditor(s => s.busy);
  const selectedTrackId = useEditor(s => s.selectedTrackId);
  const tracks = project ? projectTracks(project).filter(track => track.type === (asset.kind === 'audio' ? 'audio' : 'visual')) : [];
  const [targetId, setTargetId] = useState(() => tracks.find(track => track.id === selectedTrackId)?.id ?? tracks[0]?.id ?? '');
  const uses = project?.clips.filter(clip => clip.assetId === asset.id).length ?? 0;
  const insert = (atPlayhead: boolean) => {
    const state = useEditor.getState();
    state.addAsset(asset, atPlayhead ? state.frame : undefined, tracks.some(track => track.id === targetId) ? targetId : undefined);
    openInspectorPanel('properties');
    onClose();
  };
  return <Dialog title={asset.name} onClose={onClose}><div className="settings-form media-source-dialog">
    <SourcePreview asset={asset}/>
    <dl className="media-source-details">
      <div><dt>Type</dt><dd>{asset.kind}</dd></div>
      {asset.kind !== 'image' && <div><dt>Duration</dt><dd>{formatTime(Math.floor(asset.duration), 1)}</dd></div>}
      {asset.width && asset.height && <div><dt>Resolution</dt><dd>{asset.width} × {asset.height}</dd></div>}
      {asset.videoCodec && <div><dt>Codec</dt><dd>{asset.videoCodec.toUpperCase()}</dd></div>}
      <div><dt>Timeline usage</dt><dd>{uses} {uses === 1 ? 'clip' : 'clips'}</dd></div>
    </dl>
    <Field label="Destination track"><select aria-label="Media destination track" value={targetId} onChange={event => setTargetId(event.target.value)}>{tracks.length ? tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>) : <option value="">Create a compatible track</option>}</select></Field>
    <p className="field-help">Place at the playhead or append after the last clip on this track. Existing clips keep their position.</p>
    <div className="settings-actions"><Button icon={<ListEnd size={15}/>} disabled={busy || !project} onClick={() => insert(false)}>Append to track</Button><Button variant="primary" icon={<Plus size={15}/>} disabled={busy || !project} onClick={() => insert(true)}>Add at playhead</Button></div>
  </div></Dialog>;
}
