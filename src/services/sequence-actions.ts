import {projectTracks} from '../../shared/tracks';
import {activeSequenceId, activeSequenceName, findSequence} from '../../shared/project-sequences';
import {createId} from './id-service';
import {useEditor} from '../stores/editor-store';

export async function openSequence(id: string) {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy || activeSequenceId(project) === id) return false;
  useEditor.setState({playing: false});
  return state.execute([{type: 'sequence.open', id}], 'Opened sequence', project.revision);
}
export async function createSequence(name: string, duplicate = false) {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy) return false;
  useEditor.setState({playing: false});
  return state.execute([{type: 'sequence.create', id: createId(), name: name.trim(), ...(duplicate ? {sourceId: activeSequenceId(project)} : {})}],
    duplicate ? `Duplicated ${activeSequenceName(project)}` : 'Created sequence', project.revision);
}

export async function insertSequence(sequenceId: string, start?: number, trackId?: string) {
  const state = useEditor.getState(); const project = state.snapshot?.project;
  if(!project || state.busy) return false;
  const target = projectTracks(project).find(track => track.id === (trackId ?? state.selectedTrackId) && track.type === 'visual') ?? (!trackId ? projectTracks(project).find(track => track.type === 'visual') : undefined);
  if(!target) {useEditor.setState({error: 'Choose a video track for the nested sequence.'}); return false;}
  const id = createId(); useEditor.setState({playing: false});
  const ok = await state.execute([{type: 'sequence.insert', id, sequenceId, start: start ?? state.frame, sourceStart: 0, trackId: target.id}], 'Inserted nested sequence', project.revision);
  if(ok && useEditor.getState().snapshot?.project.sequenceId === project.sequenceId) useEditor.setState({selectedId: id, selectedTrackId: target.id, inspectorTab: 'properties'});
  return ok;
}
export async function duplicateSequenceSource(clipId: string) {
  const state = useEditor.getState(); const project = state.snapshot?.project; const clip = project?.clips.find(clip => clip.id === clipId);
  if(!project || !clip?.sequenceId || state.busy) return false;
  const id = createId();
  return state.execute([{type: 'sequence.create', id, name: `${findSequence(project, clip.sequenceId).name.slice(0, 110)} copy`, sourceId: clip.sequenceId},
    {type: 'sequence.open', id: activeSequenceId(project)}, {type: 'clip.update', id: clipId, patch: {sequenceId: id}}], 'Made sequence instance independent', project.revision);
}
