import {useState} from 'react';
import type {Project} from '../../../shared/project';
import {activeSequenceId, canNestSequence, sequenceSummaries} from '../../../shared/project-sequences';
import {insertSequence} from '../../services/sequence-actions';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function NestedSequencePicker({project, busy, onInserted}: {project: Project; busy: boolean; onInserted: () => void}) {
  const candidates = sequenceSummaries(project).filter(sequence => sequence.id !== activeSequenceId(project));
  const [selected, setSelected] = useState('');
  const id = candidates.some(sequence => sequence.id === selected && canNestSequence(project, sequence.id)) ? selected : candidates.find(sequence => canNestSequence(project, sequence.id))?.id ?? '';
  return <section><h3>Use a sequence as a clip</h3>
    <Field label="Sequence to insert"><select aria-label="Sequence to insert" value={id} onChange={event => setSelected(event.target.value)} disabled={busy || !id}>
      {!id && <option value="">Create another sequence first</option>}{candidates.map(sequence => <option key={sequence.id} value={sequence.id} disabled={!canNestSequence(project, sequence.id)}>{sequence.name} · {sequence.width} × {sequence.height} · {sequence.fps} fps</option>)}
    </select></Field>
    <div className="sequences-dialog__actions"><Button disabled={busy || !id} onClick={() => void insertSequence(id).then(ok => {if(ok) onInserted();})}>Insert sequence at playhead</Button>

    </div><p>Instances stay linked to their source, with their own trims, transforms, effects and volume. Open a source from the selected clip’s properties to edit it.</p>
  </section>;
}
