import {previewProfiles, previewQualities, type PreviewQuality} from '../../../shared/media-import';
import {setPreviewQuality, useMedia} from '../../stores/media-store';

export function PlaybackQualitySelect({className = '', label = 'Playback'}: {className?: string; label?: string}) {
  const quality = useMedia(state => state.quality);
  return <label className={`playback-quality ${className}`} title="Editing proxies are prepared once and saved with your media for faster seeking. Smaller sizes use less memory. Export always uses originals."><span>{label}</span><select aria-label="Playback quality" value={quality} onChange={event => setPreviewQuality(event.target.value as PreviewQuality)}>{previewQualities.map(value => <option key={value} value={value}>{previewProfiles[value].label}</option>)}</select></label>;
}
