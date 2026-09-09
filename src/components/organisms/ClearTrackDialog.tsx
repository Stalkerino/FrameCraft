import {projectTracks, trackClips} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';

export function ClearTrackDialog({id, onClose}: {id: string; onClose: () => void}) {
  const project = useEditor(s => s.snapshot?.project);
  const busy = useEditor(s => s.busy); const error = useEditor(s => s.error);
  const track = project && projectTracks(project).find(t => t.id === id);
  if(!project || !track) return null;
  const count = trackClips(project, id).length;
  return <Dialog title={`Clear ${track.name}?`} onClose={onClose}><div className="settings-form">
    <p className="settings-description">Remove all {count} clips from {track.name}? Your other tracks and imported media stay in place. Undo restores these clips in one step.</p>
    {error && <p className="agent-inline-error" role="alert">{error}</p>}
    <div className="settings-actions"><Button autoFocus onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !count} onClick={() => void useEditor.getState().clearTrack(id).then(ok => {if(ok) onClose();})}>Clear track</Button></div>
  </div></Dialog>;
}
