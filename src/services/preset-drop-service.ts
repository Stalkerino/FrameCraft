import {projectTracks, trackClips} from '../../shared/tracks';
import {useEditor} from '../stores/editor-store';
import {presetApi} from './preset-api';
export async function dropAssetPreset(payload: string, trackId: string, frame: number, targetClipId?: string) {
  try {
    const reference: unknown = JSON.parse(payload);
    if(!reference || typeof reference !== 'object' || !('id' in reference) || typeof reference.id !== 'string' || !('version' in reference)) throw new Error('Invalid preset drag data');
    const preset = await presetApi.get(reference.id);
    if(preset.version !== reference.version) throw new Error('Preset changed. Drag the refreshed library item again.');
    const project = useEditor.getState().snapshot?.project;
    if(!project) return; const track = projectTracks(project).find(t => t.id === trackId);
    if(!track || track.type === 'audio' || (preset.definition.category === 'transition' && track.type !== 'visual')) throw new Error('Choose a compatible video or text track.');
    const clipId = targetClipId ?? trackClips(project, trackId).find(c => c.start <= frame && c.start + c.duration > frame)?.id;
    if(preset.definition.category === 'transition' && !clipId) throw new Error('Drop the transition onto its incoming visual clip.');
    await useEditor.getState().applyPreset(preset, {}, undefined, frame, clipId, trackId);
  } catch(error) {useEditor.setState({error: (error as Error).message});}
}
