import type {Project} from '../../../shared/project';
import {activeSequenceId, sequenceSummaries} from '../../../shared/project-sequences';
import {openSequence} from '../../services/sequence-actions';
export function SequenceSelect({project, disabled}: {project: Project; disabled?: boolean}) {
  const sequences = sequenceSummaries(project).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return <select className="sequence-select" aria-label="Active sequence" value={activeSequenceId(project)} disabled={disabled} onChange={event => void openSequence(event.target.value)}>
    {sequences.map(sequence => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
  </select>;
}
