import {AudioLines, Eraser, Eye, EyeOff, Film, MoreHorizontal, Type, Volume2, VolumeX} from 'lucide-react';
import type {Track} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {IconButton} from '../atoms/Button';
export function TrackHeader({track, count, selected, busy, onSelect, onSettings, onClear}: {track: Track; count: number; selected: boolean; busy: boolean; onSelect: () => void; onSettings: () => void; onClear: () => void}) {
  const Icon = track.type === 'visual' ? Film : track.type === 'text' ? Type : AudioLines;
  const update = (patch: Partial<Track>, action: string) => void useEditor.getState().execute([{type: 'track.update', id: track.id, patch}], `${action} ${track.name}`);
  return <div className={`track-label track-header ${selected ? 'track-header--selected' : ''}`}>
    <div className="track-header__identity"><button className="track-header__select" aria-label={`Select ${track.name} track`} aria-pressed={selected} onClick={onSelect}><span className={`track-icon track-icon--${track.type}`}><Icon size={13}/></span><span>{track.name}</span></button><IconButton label={`Settings for ${track.name}`} onClick={onSettings}><MoreHorizontal size={14}/></IconButton></div>
    <div className="track-header__controls">
      {track.type !== 'audio' && <IconButton label={`${track.hidden ? 'Show' : 'Hide'} ${track.name}`} aria-pressed={track.hidden} disabled={busy} onClick={() => update({hidden: !track.hidden}, track.hidden ? 'Showed' : 'Hid')}>{track.hidden ? <EyeOff size={13}/> : <Eye size={13}/>}</IconButton>}
      {track.type !== 'text' && <IconButton label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`} aria-pressed={track.muted} disabled={busy} onClick={() => update({muted: !track.muted}, track.muted ? 'Unmuted' : 'Muted')}>{track.muted ? <VolumeX size={13}/> : <Volume2 size={13}/>}</IconButton>}
      <span>{count} clips</span><IconButton className="track-header__clear" label={`Clear ${track.name} track`} disabled={!count || busy} onClick={onClear}><Eraser size={13}/></IconButton>
    </div>
  </div>;
}
