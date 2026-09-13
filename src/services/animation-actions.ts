import {animationEditPatch, type AnimationEdit} from '../../shared/animation-editing';
import type {Clip, Project} from '../../shared/project';
import {useEditor} from '../stores/editor-store';

export async function editAnimation(project: Project, clip: Clip, edits: AnimationEdit[], label: string) {
  const state = useEditor.getState();
  if(state.busy) return false;
  if(state.snapshot?.project.id !== project.id || state.snapshot.project.revision !== project.revision) throw new Error('The project changed. Retry with the current animation.');
  let checked = clip;
  for(const edit of edits) checked = {...checked, ...animationEditPatch(checked, edit)};
  useEditor.setState({playing: false});
  return state.execute(edits.map(edit => ({type: 'clip.animate' as const, id: clip.id, edit})), label, project.revision);
}
