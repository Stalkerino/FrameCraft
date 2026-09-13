import {useRef, useState} from 'react';
import {Search, Sparkles, Upload, Volume2} from 'lucide-react';
import type {SavedSound} from '../../../shared/sound-presets';
import {useSoundLibrary} from '../../hooks/useSoundLibrary';
import {useSoundActions} from '../../hooks/useSoundActions';
import {openInspectorPanel} from '../../services/workspace-navigation';
import {useEditor} from '../../stores/editor-store';
import {useAgent, useAgentName} from '../../stores/agent-store';
import {Button} from '../atoms/Button';
import {SoundCard} from '../molecules/SoundCard';
import {SoundDetailDialog} from './SoundDetailDialog';

export function SoundLibrary() {
  const agentName = useAgentName();
  const library = useSoundLibrary(); const actions = useSoundActions(); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<SavedSound | null>(null); const input = useRef<HTMLInputElement>(null);
  const project = useEditor(state => state.snapshot?.project); const editing = useEditor(state => state.busy);
  const filtered = library.sounds.filter(sound => `${sound.definition.name} ${sound.definition.category} ${sound.definition.description}`.toLowerCase().includes(search.toLowerCase()));
  const ask = () => {const prompt = 'Use the saved sound library to add tasteful sound effects at the important cuts, reveals and labels on my timeline. Inspect timing, keep gameplay audio clear, and use list_sound_presets and apply_sound_preset. Save any custom sound recipe for reuse.'; useAgent.setState(state => ({draft: state.draft.trim() ? `${state.draft}\n\n${prompt}` : prompt})); openInspectorPanel('codex');};
  return <div className="sound-library"><p className="panel-description">Reusable whooshes, impacts and interface cues. Preview a sound, customize it, or add it at the playhead.</p>
    <div className="search-field"><Search size={14}/><input aria-label="Search sounds" value={search} placeholder="Search sounds…" onChange={event => setSearch(event.target.value)}/></div>
    <div className="sound-library__toolbar"><Button icon={<Sparkles size={14}/>} onClick={ask}>Ask {agentName}</Button><Button disabled={actions.busy} icon={<Upload size={14}/>} onClick={() => input.current?.click()}>Import recipe</Button><input ref={input} type="file" accept=".json" hidden aria-label="Import sound recipe" onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; if(file) void actions.importRecipe(file).then(saved => {if(saved) void library.refresh();});}}/></div>
    {(library.error || actions.error) && <p role="alert" className="agent-inline-error">{actions.error || library.error}</p>}
    <div className="sound-library__list">{filtered.map(sound => <SoundCard key={`${sound.id}-${sound.version}`} sound={sound} playing={library.playing === sound.id} busy={actions.busy || editing || !project} onPreview={() => void library.preview(sound, {})} onOpen={() => {library.stop(); setSelected(sound);}} onAdd={() => void actions.add(sound)}/>)}</div>
    {!filtered.length && <div className="empty-state"><Volume2 size={24}/><p>{library.loaded ? 'No matching sounds' : 'Loading sound library…'}</p></div>}
    <p className="library-note">Procedural audio made locally. Sounds are saved across projects; imported music and recordings remain in Project audio.</p>
    {selected && <SoundDetailDialog key={`${selected.id}-${selected.version}`} sound={selected} playing={library.playing === selected.id} onPreview={values => void library.preview(selected, values)} onStop={library.stop} onClose={() => {library.stop(); setSelected(null);}} onSaved={() => void library.refresh()}/>}
  </div>;
}
