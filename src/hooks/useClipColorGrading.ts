import type {ColorGrade} from '../../shared/color-grading';
import {useEditor} from '../stores/editor-store';

/** Clip color changes use the same revision-checked editing service as MCP. */
export function useClipColorGrading(clipId: string) {
  const busy = useEditor(state => state.busy);
  const save = (grade: ColorGrade | null) => useEditor.getState().updateClip(clipId, {colorGrade: grade}, grade ? 'Changed clip color grade' : 'Reset clip color grade');
  return {busy, save};
}
