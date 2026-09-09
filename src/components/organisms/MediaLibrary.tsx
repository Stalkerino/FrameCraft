import {AudioLines, Boxes, Check, Film, FolderPlus, Grid2X2, Layers3, List, LoaderCircle, Search, Sparkles, Type, Upload, WandSparkles, X} from 'lucide-react';
import {useRef, useState} from 'react';
import {useEditor} from '../../stores/editor-store';
import {openLibraryPanel, openInspectorPanel} from '../../services/workspace-navigation';
import {useAnalysis} from '../../stores/analysis-store';
import {MediaCard} from '../molecules/MediaCard';
import {MediaSourceDialog} from '../molecules/MediaSourceDialog';
import {Button, IconButton} from '../atoms/Button';
import {transitions} from '../../video/effects/registry';
import type {Asset, EffectName} from '../../../shared/project';
import {AssistWorkspace} from './AssistWorkspace';
import {AssetStudio} from './AssetStudio';
import {SoundLibrary} from './SoundLibrary';

const libraryTabs = [
  {id: 'media', label: 'Media', icon: Film},
  {id: 'audio', label: 'Audio', icon: AudioLines},
  {id: 'text', label: 'Titles', icon: Type},
  {id: 'effects', label: 'Effects', icon: Layers3},
  {id: 'assets', label: 'Presets', icon: Boxes},
  {id: 'assist', label: 'Tools', icon: WandSparkles},
] as const;

export function MediaLibrary() {
  const tab = useEditor(s => s.libraryTab);
  const snapshot = useEditor(s => s.snapshot);
  const importing = useEditor(s => s.importing);
  const busy = useEditor(s => s.busy);
  const selectedId = useEditor(s => s.selectedId);
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | Asset['kind']>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dragging, setDragging] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [audioView, setAudioView] = useState<'project' | 'sounds'>('project');
  const mediaTab = tab === 'media' || tab === 'audio';
  const projectMediaTab = mediaTab && (tab !== 'audio' || audioView === 'project');
  const project = snapshot?.project;
  const assets = project?.assets.filter(asset => (tab === 'audio' ? asset.kind === 'audio' : kind === 'all' || asset.kind === kind) && asset.name.toLowerCase().includes(search.toLowerCase())) ?? [];
  const selected = project?.clips.find(clip => clip.id === selectedId);
  const transitionTarget = selected?.track === 'visual' ? selected : null;
  const previewAsset = project?.assets.find(asset => asset.id === previewId);
  const usage = new Map<string, number>();
  for(const clip of project?.clips ?? []) if(clip.assetId) usage.set(clip.assetId, (usage.get(clip.assetId) ?? 0) + 1);
  const openAssist = (assistTab: 'speech' | 'overlays') => {useAnalysis.setState({tab: assistTab}); openLibraryPanel('assist');};
  return <aside className={`library-shell ${tab === 'assist' ? 'library-shell--assist' : tab === 'assets' ? 'library-shell--assets' : ''}`} aria-label="Editing tools and library">
    <nav className="tool-rail" aria-label="Editor tools">
      {libraryTabs.map(({id, label, icon: Icon}) => <button key={id} aria-label={label} aria-pressed={tab === id} title={label} className={tab === id ? 'active' : ''} onClick={() => openLibraryPanel(id)}><Icon size={19}/><span>{label}</span></button>)}
      <button className="tool-rail__agent" title="Open Codex assistant" onClick={() => openInspectorPanel('codex')}><Sparkles size={19}/><span>Codex</span></button>
    </nav>
    {tab === 'assets' ? <AssetStudio/> : tab === 'assist' ? <AssistWorkspace/> : <section className={`library ${dragging ? 'library--drop' : ''}`}
      onDragOver={event => {if(event.dataTransfer.types.includes('Files')) {event.preventDefault(); setDragging(true);}}}
      onDragLeave={event => {if(!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);}}
      onDrop={event => {setDragging(false); if(event.dataTransfer.files.length) {event.preventDefault(); if(tab === 'audio') setAudioView('project'); void useEditor.getState().importFiles(Array.from(event.dataTransfer.files));}}}>
      <div className="panel-heading"><h2>{tab === 'media' ? 'Project media' : tab === 'text' ? 'Titles & text' : tab === 'effects' ? 'Transitions & motion' : 'Audio library'}</h2>{projectMediaTab && <span className="count-badge">{assets.length}</span>}</div>
      {tab === 'audio' && <div className="audio-library-tabs" aria-label="Audio source"><button aria-pressed={audioView === 'project'} onClick={() => setAudioView('project')}>Project audio</button><button aria-pressed={audioView === 'sounds'} onClick={() => setAudioView('sounds')}>Sound library</button></div>}
      <input ref={input} type="file" multiple hidden aria-label="Import media files" accept={tab === 'audio' ? 'audio/*' : 'video/*,audio/*,.png,.jpg,.jpeg,.webp,.mkv'} onChange={event => {void useEditor.getState().importFiles(Array.from(event.target.files || [])); event.target.value = '';}}/>
      {projectMediaTab && <>
        <div className="library-actions"><Button className="import-button" icon={importing ? <LoaderCircle size={15} className="spin"/> : <Upload size={15}/>} onClick={() => input.current?.click()} disabled={!!importing}>{importing ? 'Importing…' : tab === 'audio' ? 'Import audio' : 'Import media'}</Button><div className="library-view" aria-label="Library view"><IconButton label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={15}/></IconButton><IconButton label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15}/></IconButton></div></div>
        <div className="search-field"><Search size={14}/><input aria-label="Search media" placeholder="Search files…" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button aria-label="Clear media search" onClick={() => setSearch('')}><X size={13}/></button>}</div>
        {tab === 'media' && <div className="library-filters" aria-label="Filter media type">{(['all', 'video', 'image', 'audio'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'image' ? 'Images' : value === 'video' ? 'Video' : 'Audio'}</button>)}</div>}
        <p className="library-instructions">Click to preview · Drag to a track · + to append</p>
        <div className={`media-grid ${view === 'list' ? 'media-grid--list' : ''}`}>{assets.map(asset => <MediaCard key={asset.id} asset={asset} uses={usage.get(asset.id)} onPreview={() => {useEditor.setState({playing: false}); setPreviewId(asset.id);}}/>)}</div>
        {!assets.length && <div className="empty-state library-empty"><FolderPlus size={26}/><p>{search || (tab === 'media' && kind !== 'all') ? 'No matching media' : tab === 'audio' ? 'Add music or sound effects' : 'Import your source media'}</p><span>{search ? 'Try another filename or clear the search.' : 'Choose files or drop them into this panel.'}</span>{search && <Button variant="ghost" onClick={() => setSearch('')}>Clear search</Button>}</div>}
        <button className="drop-zone" onClick={() => input.current?.click()} disabled={!!importing}><FolderPlus size={18}/><span>{importing || 'Drop files to import'}</span><small>{importing ? 'Copying into this project’s media folder' : tab === 'audio' ? 'Music, dialogue & sound effects' : 'Video, images & audio'}</small></button>
      </>}
      {tab === 'audio' && audioView === 'sounds' && <SoundLibrary/>}
      {tab === 'text' && <>
        <p className="panel-description">Add an editable text clip at the playhead.</p>
        <div className="preset-list">{(['title', 'subtitle', 'label'] as const).map((preset, index) => <button key={preset} disabled={busy || !project} className={`text-preset text-preset--${preset}`} onClick={() => useEditor.getState().addText(preset)}><span>{['Title', 'Subtitle text', 'CHAPTER 01'][index]}</span><small>{['Heading', 'Subtitle', 'Chapter label'][index]} <span>+</span></small></button>)}</div>
        <div className="library-tool-links"><button onClick={() => openLibraryPanel('assets')}><Boxes size={16}/><span>Animated title presets<small>Saved titles, lower thirds and graphics</small></span></button><button onClick={() => openAssist('speech')}><AudioLines size={16}/><span>Generate captions<small>Transcribe speech into timed text</small></span></button></div>
      </>}
      {tab === 'effects' && <>
        <div className={`selection-context ${transitionTarget ? 'selection-context--ready' : ''}`}><span>{transitionTarget ? 'Apply to selected clip' : 'Select a visual clip'}</span><strong>{transitionTarget?.name ?? 'Choose a video, image or background on the timeline.'}</strong></div>
        <div className="effect-list">{Object.entries(transitions).map(([key, effect]) => <button key={key} className="effect-card" disabled={!transitionTarget || busy} aria-pressed={!!transitionTarget && !transitionTarget.presetTransition && transitionTarget.transition === key} onClick={() => {if(!transitionTarget) return; void useEditor.getState().updateClip(transitionTarget.id, {transition: key as EffectName, presetTransition: null}, `Applied ${effect.name}`); openInspectorPanel('properties');}}><div className={`effect-swatch effect-swatch--${key}`}><span/></div><span>{key === 'none' ? 'No transition' : effect.name}<small>{key === 'none' ? 'A straight cut at the start of the clip' : effect.description}</small></span>{transitionTarget && !transitionTarget.presetTransition && transitionTarget.transition === key && <Check size={15}/>}</button>)}</div>
        <p className="library-note">Transitions affect the start of the selected clip. Adjust their duration in Properties.</p>
        <div className="library-tool-links"><button onClick={() => openLibraryPanel('assets')}><Boxes size={16}/><span>Saved transitions<small>Browse reusable custom effects</small></span></button><button onClick={() => openAssist('overlays')}><WandSparkles size={16}/><span>Zooms & callouts<small>Animate a focus point or add a shape</small></span></button></div>
      </>}
      <div className="library-footer"><span className="status-dot"/> {tab === 'audio' && audioView === 'sounds' ? 'Sound recipes shared across projects' : mediaTab ? 'Media saved in this project' : 'Changes are saved automatically'}</div>
    </section>}
    {previewAsset && <MediaSourceDialog key={previewAsset.id} asset={previewAsset} onClose={() => setPreviewId(null)}/>}
  </aside>;
}
