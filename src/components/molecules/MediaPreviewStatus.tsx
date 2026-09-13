import type {Asset} from '../../../shared/project';
import {changeMediaPreview, useMedia} from '../../stores/media-store';
import {mediaPreviewKey, previewProfiles} from '../../../shared/media-import';

export function MediaPreviewStatus({asset, background = false}: {asset: Asset; background?: boolean}) {
  const selectedQuality = useMedia(s => s.quality);
  const state = useMedia(s => {
    const selected = s.previews[mediaPreviewKey(asset.id, selectedQuality)];
    return background && (!selected || ['idle', 'ready'].includes(selected.status)) ? s.previews[mediaPreviewKey(asset.id, 'performance')] : selected;
  });
  const quality = state?.quality ?? selectedQuality;
  if(!state || state.status === 'idle' || state.status === 'ready' && !background) return null;
  const working = ['queued', 'running'].includes(state.status);
  const prefix = quality === 'high' ? 'Full-resolution playback' : previewProfiles[quality].label;
  const label = state.status === 'ready' ? `${prefix} ready` : state.status === 'queued' ? `${prefix} queued` : state.status === 'running' ? `${prefix} · ${Math.round(state.progress * 100)}%` : state.status === 'cancelled' ? 'Playback preparation stopped' : 'Playback preparation failed';
  return <div className="media-preview-status" title={state.error || state.warning || 'Background playback copy. Original quality is retained for export.'}>
    <span role="status">{label}{state.encoding && state.status === 'running' ? ` · ${state.encoding}` : ''}</span>
    {working && <progress aria-label={`Preview progress for ${asset.name}`} max={1} value={state?.progress ?? 0}/>}
    {state.status !== 'ready' && <button type="button" onClick={() => void changeMediaPreview(asset.id, working ? 'cancel' : 'retry', quality)} aria-label={`${working ? 'Stop' : 'Retry'} preview for ${asset.name}`}>{working ? 'Stop' : 'Retry'}</button>}
  </div>;
}
