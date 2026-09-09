import type {Clip} from '../../shared/project';
import {visualStateAtFrame} from '../../shared/visual-editing';
import {visualPropertyPatch, type VisualValues} from '../services/visual-editing-service';
import {useEditor} from '../stores/editor-store';

export function useVisualEditing(clip: Clip) {
  const frame = useEditor(state => state.frame);
  const busy = useEditor(state => state.busy);
  const localFrame = Math.max(0, Math.min(clip.duration - 1, frame - clip.start));
  const inside = frame >= clip.start && frame < clip.start + clip.duration;
  const value = visualStateAtFrame(clip, localFrame);
  const update = (values: Partial<VisualValues>) => {
    const current = useEditor.getState().snapshot?.project.clips.find(candidate => candidate.id === clip.id);
    if(!current) return;
    const patch = visualPropertyPatch(current, localFrame, values);
    if(Object.keys(patch).length) void useEditor.getState().updateClip(clip.id, patch, 'Changed visual transform');
  };
  return {value, localFrame, inside, busy, update};
}
