import {NestedSequencePicker} from '../molecules/NestedSequencePicker';
import {useState} from 'react';
import {activeSequenceId, activeSequenceName} from '../../../shared/project-sequences';
import {useEditor} from '../../stores/editor-store';
import {createSequence} from '../../services/sequence-actions';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';

export function SequencesDialog({onClose}: {onClose: () => void}) {
  const project = useEditor(s => s.snapshot?.project); const busy = useEditor(s => s.busy); const error = useEditor(s => s.error);
  const [name, setName] = useState(project ? activeSequenceName(project) : '');
  const [newName, setNewName] = useState(''); const [deleting, setDeleting] = useState(false);
  if(!project) return null;
  const execute = useEditor.getState().execute;
  const create = async (duplicate: boolean) => {if(await createSequence(newName, duplicate)) onClose();};
  return <Dialog title="Sequences" onClose={onClose}><div className="sequences-dialog">
    <p>Each sequence has its own timeline, canvas, frame rate, markers and export settings. All sequences share this project’s media library.</p>
    <section><h3>Current sequence</h3>
      <Field label="Sequence name"><input aria-label="Sequence name" maxLength={120} value={name} onChange={event => setName(event.target.value)}/></Field>
      <div className="sequences-dialog__actions"><Button disabled={busy || !name.trim() || name.trim() === activeSequenceName(project)} onClick={() => void execute([{type: 'sequence.rename', id: activeSequenceId(project), name: name.trim()}], 'Renamed sequence', project.revision)}>Rename sequence</Button>
      <Button disabled={busy || !project.sequences?.length} onClick={() => setDeleting(true)}>Delete sequence…</Button></div>
      {deleting && <div className="sequences-dialog__confirm"><p>Delete “{activeSequenceName(project)}” and its timeline? Media files are kept. You can undo this.</p><Button onClick={() => setDeleting(false)}>Cancel</Button><Button disabled={busy} onClick={() => void execute([{type: 'sequence.remove', id: activeSequenceId(project)}], 'Deleted sequence', project.revision).then(ok => {if(ok) onClose();})}>Confirm delete sequence</Button></div>}
    </section>
    <section><h3>Create a sequence</h3><Field label="New sequence name"><input aria-label="New sequence name" placeholder="Short version, Intro, Vertical…" maxLength={120} value={newName} onChange={event => setNewName(event.target.value)}/></Field>
      <div className="sequences-dialog__actions"><Button disabled={busy || !newName.trim()} onClick={() => void create(false)}>Create blank sequence</Button><Button disabled={busy || !newName.trim()} onClick={() => void create(true)}>Duplicate current sequence</Button></div>
    </section>
    <NestedSequencePicker project={project} busy={busy} onInserted={onClose}/>
    <p>Switch sequences using the selector above the timeline. Canvas and export controls apply to the active sequence. Copies are independent; undo/redo follows the project history, including sequence changes.</p>
    {error && <p role="alert" className="agent-inline-error">{error}</p>}
  </div></Dialog>;
}
