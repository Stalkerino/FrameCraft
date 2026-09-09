import {Play, Plus, Square, Volume2} from 'lucide-react';
import type {SavedSound} from '../../../shared/sound-presets';
import {IconButton} from '../atoms/Button';
export function SoundCard({sound, playing, busy, onPreview, onOpen, onAdd}: {sound: SavedSound; playing: boolean; busy: boolean; onPreview: () => void; onOpen: () => void; onAdd: () => void}) {
  return <article className="sound-card"><IconButton label={`${playing ? 'Stop' : 'Preview'} ${sound.definition.name}`} onClick={onPreview}>{playing ? <Square size={15}/> : <Play size={15}/>}</IconButton><button className="sound-card__details" onClick={onOpen}><strong>{sound.definition.name}</strong><small>{sound.definition.category} · {sound.definition.duration}s</small></button><Volume2 size={16} className="sound-card__wave"/><IconButton label={`Add ${sound.definition.name} at playhead`} disabled={busy} onClick={onAdd}><Plus size={16}/></IconButton></article>;
}
