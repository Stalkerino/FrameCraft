import type {PreviewQuality} from '../../../shared/media-import';
import {setPreviewQuality, useMedia} from '../../stores/media-store';

export function PlaybackQualitySelect({className = '', label = 'Playback'}: {className?: string; label?: string}) {
  const quality = useMedia(state => state.quality);
  return <label className={`playback-quality ${className}`}><span>{label}</span><select aria-label="Playback quality" value={quality} onChange={event => setPreviewQuality(event.target.value as PreviewQuality)}><option value="high">Full quality</option><option value="performance">Performance proxy</option></select></label>;
}
