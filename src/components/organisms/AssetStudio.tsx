import {useRef, useState} from 'react';
import {Boxes, Plus, Search, Sparkles, Upload} from 'lucide-react';
import type {PresetDefinition, SavedPreset} from '../../../shared/asset-presets';
import {presetStarters} from '../../../shared/preset-starters';
import {presetApi} from '../../services/preset-api';
import {usePresets} from '../../stores/preset-store';
import {openInspectorPanel} from '../../services/workspace-navigation';
import {Button} from '../atoms/Button';
import {PresetCard} from '../molecules/PresetCard';
import {PresetDetailDialog} from './PresetDetailDialog';
import {PresetEditorDialog} from './PresetEditorDialog';
export function AssetStudio() {
  const {presets, loaded, error: libraryError} = usePresets(); const [query, setQuery] = useState(''); const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<SavedPreset | null>(null); const [editing, setEditing] = useState<{definition: PresetDefinition; existing?: SavedPreset} | null>(null); const [error, setError] = useState(''); const input = useRef<HTMLInputElement>(null);
  const filtered = presets.filter(p => (category === 'all' || p.definition.category === category) && `${p.definition.name} ${p.definition.description} ${p.definition.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.definition.name.localeCompare(b.definition.name));
  const saved = (preset: SavedPreset) => {setEditing(null); setSelected(preset); void usePresets.getState().refresh();};
  return <section className="asset-studio" onKeyDown={event => event.stopPropagation()}><div className="panel-heading"><h2>Saved presets</h2><span className="count-badge">{presets.length}</span></div><p className="panel-description">Reusable titles, transitions and graphics.</p>
    <div className="asset-studio__actions"><Button icon={<Plus size={14}/>} onClick={() => setEditing({definition: {...structuredClone(presetStarters[1].definition), name: 'My Chapter Title'}})}>Create preset</Button><Button icon={<Upload size={14}/>} onClick={() => input.current?.click()}>Import</Button><input ref={input} type="file" accept=".json" hidden aria-label="Import asset preset" onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; if(file) void presetApi.import(file).then(saved).catch(error => setError(error.message));}}/></div>
    <div className="search-field"><Search size={14}/><input aria-label="Search asset presets" value={query} placeholder="Search presets…" onChange={event => setQuery(event.target.value)}/></div><select className="asset-filter" aria-label="Asset category" value={category} onChange={event => setCategory(event.target.value)}>{['all', 'transition', 'title', 'lower-third', 'background', 'overlay', 'intro', 'outro'].map(value => <option key={value} value={value}>{value === 'all' ? 'All categories' : value.replace('-', ' ')}</option>)}</select>
    {(error || libraryError) && <p role="alert" className="agent-inline-error">{error || libraryError}</p>}
    <div className="asset-studio__grid">{filtered.map(preset => <PresetCard key={preset.id} preset={preset} onOpen={() => setSelected(preset)}/>)}</div>
    {!filtered.length && <div className="empty-state"><Boxes size={24}/><p>{loaded ? query || category !== 'all' ? 'No matching presets' : 'No saved presets yet' : 'Loading presets…'}</p><span>{query || category !== 'all' ? 'Try another search or category.' : 'Create a preset or ask Codex to generate one.'}</span>{(query || category !== 'all') && <Button variant="ghost" onClick={() => {setQuery(''); setCategory('all');}}>Clear filters</Button>}</div>}
    <p className="library-note">Click to preview and customize, or drag to the timeline. Presets are saved locally and shared across projects.</p>
    <Button className="asset-studio__codex" icon={<Sparkles size={14}/>} onClick={() => openInspectorPanel('codex')}>Create with Codex</Button>
    {selected && <PresetDetailDialog key={`${selected.id}-${selected.version}`} preset={selected} onClose={() => setSelected(null)} onSaved={saved} onEdit={() => {setEditing({definition: selected.definition, existing: selected}); setSelected(null);}}/>}
    {editing && <PresetEditorDialog initial={editing.definition} existing={editing.existing} onClose={() => setEditing(null)} onSaved={saved}/>}
  </section>;
}
