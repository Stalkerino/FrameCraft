import type {Asset} from '../../../shared/project';
import {changeMediaPreview, useMedia} from '../../stores/media-store';
import {mediaPreviewKey} from '../../../shared/media-import';

export function MediaPreviewStatus({asset}: {asset: Asset}) {
  const quality = useMedia(s => s.quality);
  const state = useMedia(s => s.previews[mediaPreviewKey(asset.id, quality)]);
  if(!state || ['ready', 'idle'].includes(state.status)) return null;
  const working = ['queued', 'running'].includes(state.status);
  const prefix = quality === 'high' ? 'Full-resolution playback' : 'Performance proxy';
  const label = state.status === 'queued' ? `${prefix} queued` : state.status === 'running' ? `${prefix} · ${Math.round(state.progress * 100)}%` : state.status === 'cancelled' ? 'Playback preparation stopped' : 'Playback preparation failed';
  return <div className="media-preview-status" title={state?.error || `${asset.videoCodec?.toUpperCase() || 'This format'} needs a compatible playback copy. Original quality is retained for export.`}>
    <span role="status">{label}</span>
    {working && <progress aria-label={`Preview progress for ${asset.name}`} max={1} value={state?.progress ?? 0}/>}
    <button type="button" onClick={() => void changeMediaPreview(asset.id, working ? 'cancel' : 'retry', quality)} aria-label={`${working ? 'Stop' : 'Retry'} preview for ${asset.name}`}>{working ? 'Stop' : 'Retry'}</button>
  </div>;
}
