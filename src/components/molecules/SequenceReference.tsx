import type {Clip, Project} from '../../../shared/project';
import {findSequence, sequenceDuration} from '../../../shared/project-sequences';
import {openSequence, duplicateSequenceSource} from '../../services/sequence-actions';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {PropertySection} from '../atoms/PropertySection';
export function SequenceReference({clip, project}: {clip: Clip; project: Project}) {
  const source = findSequence(project, clip.sequenceId!); const busy = useEditor(state => state.busy);
  const available = Math.max(1, Math.round(sequenceDuration(source) / source.fps * project.fps) - clip.sourceStart);
  return <PropertySection title="Nested sequence" summary={source.name}>
    <p className="field-help">Linked to {source.name} · {source.width} × {source.height} · {source.fps} fps. Source edits update every instance. This instance keeps its duration; unused source time shows the sequence background with silence.</p>
    <div className="sequence-reference-actions"><Button disabled={busy} onClick={() => void openSequence(source.id)}>Open source sequence</Button>
      <Button disabled={busy || clip.duration === available} onClick={() => void useEditor.getState().updateClip(clip.id, {duration: available}, 'Matched sequence duration')}>Match source duration</Button>
      <Button disabled={busy} onClick={() => void duplicateSequenceSource(clip.id)}>Duplicate source for this instance</Button></div>
  </PropertySection>;
}
