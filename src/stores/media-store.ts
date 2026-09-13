import {create} from 'zustand';
import {mediaPreviewKey, previewQualities, type MediaPreviews, type PreviewQuality} from '../../shared/media-import';
import {mediaApi} from '../services/media-api';
import {useEditor} from './editor-store';

function savedQuality(): PreviewQuality {try {const saved = localStorage.getItem('framecraft.preview-quality'); return previewQualities.find(quality => quality === saved) ?? 'high';} catch {return 'high';}}
interface MediaState {previews: MediaPreviews; quality: PreviewQuality; unsupportedOriginals: Record<string, boolean>}
export const useMedia = create<MediaState>(() => ({previews: {}, quality: savedQuality(), unsupportedOriginals: {}}));
export function connectMedia() {return mediaApi.subscribe(previews => useMedia.setState({previews}));}
export function setPreviewQuality(quality: PreviewQuality) {
  useMedia.setState({quality});
  try {localStorage.setItem('framecraft.preview-quality', quality);} catch { /* Session choice still applies. */ }
}
export function rejectOriginalPlayback(assetId: string) {useMedia.setState(state => ({unsupportedOriginals: {...state.unsupportedOriginals, [assetId]: true}}));}
export async function changeMediaPreview(assetId: string, action: 'cancel' | 'retry' | 'ensure', quality: PreviewQuality = useMedia.getState().quality) {
  try {
    const preview = await mediaApi.action(assetId, action, quality);
    if(quality === 'high' && preview.quality !== 'high') throw new Error('Restart the Framecraft server to enable full-resolution playback.');
    useMedia.setState(state => ({previews: {...state.previews, [mediaPreviewKey(assetId, quality)]: preview}}));
  }
  catch(error) {useEditor.setState({error: (error as Error).message});}
}
