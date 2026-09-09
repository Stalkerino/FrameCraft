import {AlignCenter, AlignLeft, AlignRight, AudioLines, Boxes, Copy, Crosshair, Film, Image, SlidersHorizontal, Sparkles, Trash2, Type, Video} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useEditor} from '../../stores/editor-store';
import {openLibraryPanel, openInspectorPanel} from '../../services/workspace-navigation';
import {Field, NumberField} from '../atoms/Field';
import {Button, IconButton} from '../atoms/Button';
import {PropertySection} from '../atoms/PropertySection';
import {transitions} from '../../video/effects/registry';
import {CodexPanel} from './CodexPanel';
import {AudioProperties} from './AudioProperties';
import {ClipColorGrading} from './ClipColorGrading';
import {TransformProperties} from './TransformProperties';
import {TransformKeyframes} from './TransformKeyframes';
import {CropMaskProperties} from './CropMaskProperties';
import {SpeedProperties} from './SpeedProperties';
import {OverlayProperties} from '../molecules/OverlayProperties';
import {PresetInstanceProperties} from '../molecules/PresetInstanceProperties';
import {durationOf, formatTimecode, type Clip, type EffectName} from '../../../shared/project';
import {acceptsClip, clipTrackId, projectTracks} from '../../../shared/tracks';

export function Inspector() {
  const snapshot = useEditor(s => s.snapshot);
  const id = useEditor(s => s.selectedId);
  const tab = useEditor(s => s.inspectorTab);
  const clip = snapshot?.project.clips.find(candidate => candidate.id === id);
  return <aside className={`inspector ${tab === 'codex' ? 'inspector--codex' : ''}`} aria-label="Inspector and Codex">
    <div className="inspector-tabs"><button aria-pressed={tab === 'properties'} className={tab === 'properties' ? 'active' : ''} onClick={() => openInspectorPanel('properties')}><SlidersHorizontal size={14}/> Properties</button><button aria-pressed={tab === 'codex'} className={tab === 'codex' ? 'active' : ''} onClick={() => openInspectorPanel('codex')}><Sparkles size={14}/> Codex <span className="ai-badge">AI</span></button></div>
    {tab === 'codex' ? <CodexPanel/> : clip ? <ClipProperties key={clip.id} clip={clip}/> : <div className="inspector-content">
      <div className="empty-state inspector-empty"><SlidersHorizontal size={25}/><p>No clip selected</p><span>Select a clip on the timeline or canvas to edit its properties.</span></div>
      {snapshot && <section className="inspector-project-summary"><h3>{snapshot.project.name}</h3><dl><div><dt>Sequence</dt><dd>{snapshot.project.width} × {snapshot.project.height}</dd></div><div><dt>Frame rate</dt><dd>{snapshot.project.fps} fps</dd></div><div><dt>Duration</dt><dd>{formatTimecode(durationOf(snapshot.project), snapshot.project.fps)}</dd></div><div><dt>Timeline</dt><dd>{snapshot.project.clips.length} clips · {projectTracks(snapshot.project).length} tracks</dd></div></dl></section>}
      <div className="inspector-start-actions"><Button icon={<Film size={14}/>} onClick={() => openLibraryPanel('media')}>Browse media</Button><Button icon={<Type size={14}/>} onClick={() => openLibraryPanel('text')}>Add a title</Button></div>
    </div>}
  </aside>;
}

function ClipProperties({clip}: {clip: Clip}) {
  const fps = useEditor(s => s.snapshot?.project.fps ?? 30);
  const project = useEditor(s => s.snapshot?.project);
  const busy = useEditor(s => s.busy);
  const [text, setText] = useState(clip.text);
  const [name, setName] = useState(clip.name);
  useEffect(() => setText(clip.text), [clip.text]);
  useEffect(() => setName(clip.name), [clip.name]);
  const patch = (value: Partial<Clip>, label?: string) => {void useEditor.getState().updateClip(clip.id, value, label);};
  const commitName = () => {const next = name.trim(); if(next && next !== clip.name) patch({name: next}, 'Renamed clip'); else setName(clip.name);};
  const asset = project?.assets.find(candidate => candidate.id === clip.assetId);
  const sourceLength = asset && (clip.kind === 'video' || clip.kind === 'audio') ? Math.floor(asset.duration * fps + 1e-7) : undefined;
  const Icon = clip.kind === 'text' ? Type : clip.kind === 'audio' ? AudioLines : clip.kind === 'image' ? Image : clip.kind === 'graphic' || clip.kind === 'annotation' ? Boxes : Video;
  const transitionName = clip.presetTransition?.definition.name ?? transitions[clip.transition].name;
  return <>
    <div className="selection-heading"><div className={`selection-icon selection-icon--${clip.track}`}><Icon size={17}/></div><div><input aria-label="Clip name" title="Rename selected clip" maxLength={240} value={name} onChange={event => setName(event.target.value)} onBlur={commitName} onKeyDown={event => {if(event.key === 'Enter') event.currentTarget.blur(); if(event.key === 'Escape') {setName(clip.name); event.stopPropagation();}}}/><span>{clip.kind === 'text' ? clip.caption ? 'Caption clip' : 'Text clip' : `${clip.kind[0].toUpperCase()}${clip.kind.slice(1)} clip`}</span></div><IconButton label="Go to clip start" onClick={() => {useEditor.setState({playing: false}); useEditor.getState().seekTo(clip.start);}}><Crosshair size={14}/></IconButton><IconButton label="Duplicate clip" title="Duplicate clip (Ctrl+D)" disabled={busy} onClick={() => void useEditor.getState().duplicateClip()}><Copy size={14}/></IconButton></div>
    <div className="inspector-content">
      {clip.kind === 'text' && <PropertySection title="Text & style">
        <textarea aria-label="Text content" readOnly={!!clip.caption} value={text} rows={3} onChange={event => setText(event.target.value)} onBlur={() => {if(text !== clip.text) patch({text}, 'Edited text');}}/>
        {clip.caption && <p className="field-help">Caption words follow the transcript. Caption options are below.</p>}
        <Field label="Font weight"><select aria-label="Font weight" value={clip.weight} onChange={event => patch({weight: event.target.value as Clip['weight']})}><option value="800">Sans · Extra bold</option><option value="600">Sans · Semibold</option><option value="400">Sans · Regular</option></select></Field>
        <div className="field-row"><NumberField label="Size" value={clip.fontSize} min={4} max={2000} suffix="px" onCommit={fontSize => patch({fontSize})}/><Field label="Color"><div className="color-field"><input aria-label="Text color" type="color" value={clip.color} onChange={event => patch({color: event.target.value})}/><span>{clip.color.toUpperCase()}</span></div></Field></div>
        <div className="alignment-control" aria-label="Text alignment">{([{value: 'left', icon: AlignLeft}, {value: 'center', icon: AlignCenter}, {value: 'right', icon: AlignRight}] as const).map(({value, icon: AlignIcon}) => <button aria-label={`Align ${value}`} aria-pressed={clip.align === value} key={value} className={clip.align === value ? 'active' : ''} onClick={() => patch({align: value})}><AlignIcon size={16}/></button>)}</div>
      </PropertySection>}
      <PropertySection title="Timing & track" summary={`${(clip.duration / fps).toFixed(2)} s`}>
        <div className="field-row"><NumberField label="Start" value={clip.start / fps} step={1 / fps} suffix="s" onCommit={start => patch({start: Math.round(start * fps)})}/><NumberField label="Duration" value={clip.duration / fps} min={1 / fps} max={sourceLength === undefined ? undefined : (sourceLength - clip.sourceStart) / fps} step={1 / fps} suffix="s" onCommit={duration => patch({duration: Math.max(1, Math.round(duration * fps))})}/></div>
        {(clip.kind === 'video' || clip.kind === 'audio') && <NumberField label="Source in" value={clip.sourceStart / fps} max={sourceLength === undefined ? undefined : Math.max(0, sourceLength - clip.duration) / fps} step={1 / fps} suffix="s" onCommit={sourceStart => patch({sourceStart: Math.round(sourceStart * fps)})}/>}
        {project && <Field label="Timeline track"><select aria-label="Timeline track" value={clipTrackId(project, clip)} onChange={event => void useEditor.getState().execute([{type: 'clip.move-track', id: clip.id, trackId: event.target.value}], `Moved ${clip.name} to another track`)}>{projectTracks(project).filter(track => acceptsClip(track, clip)).map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field>}
      </PropertySection>
      {project && (clip.kind === 'video' || clip.kind === 'audio') && <PropertySection title="Speed & timing" defaultOpen={!!asset?.speedProcessing}><SpeedProperties clip={clip} project={project}/></PropertySection>}
      {clip.track !== 'audio' && <TransformProperties clip={clip}/>}
      {project && clip.track !== 'audio' && <TransformKeyframes clip={clip} project={project}/>}
      {project && clip.track !== 'audio' && <CropMaskProperties clip={clip} project={project}/>}
      <OverlayProperties clip={clip} patch={patch}/>
      {(clip.kind === 'video' || clip.kind === 'image') && <ClipColorGrading clip={clip}/>}
      <PresetInstanceProperties clip={clip} patch={patch}/>
      {clip.kind === 'text' && <PropertySection title="Text animation" defaultOpen={false} summary={clip.animation === 'none' ? 'None' : clip.animation === 'rise' ? 'Fade & rise' : 'Typewriter'}><Field label="Entrance"><select aria-label="Text animation" value={clip.animation} onChange={event => patch({animation: event.target.value as Clip['animation']})}><option value="none">None</option><option value="rise">Fade & rise</option><option value="typewriter">Typewriter</option></select></Field></PropertySection>}
      {clip.track === 'visual' && <PropertySection title="Transition in" summary={transitionName} defaultOpen={clip.transition !== 'none' || !!clip.presetTransition}>
        <Field label="Effect"><select aria-label="Transition effect" value={clip.presetTransition ? 'preset' : clip.transition} onChange={event => patch({transition: event.target.value as EffectName, presetTransition: null})}>{clip.presetTransition && <option value="preset">{clip.presetTransition.definition.name}</option>}{Object.entries(transitions).map(([id, transition]) => <option value={id} key={id}>{transition.name}</option>)}</select></Field>
        {(clip.transition !== 'none' || clip.presetTransition) && <NumberField label="Transition duration" value={clip.transitionFrames / fps} min={clip.presetTransition ? .1 : 1 / fps} max={clip.presetTransition ? 120 : 5} step={1 / fps} suffix="s" onCommit={value => patch({transitionFrames: Math.round(value * fps), ...(clip.presetTransition ? {presetTransition: {...clip.presetTransition, duration: value}} : {})})}/>}
        <p className="field-help">Reveals this clip over the previous frame. Clip timing stays fixed.</p>
      </PropertySection>}
      {project && (clip.kind === 'video' || clip.kind === 'audio') && <PropertySection title="Audio" summary={clip.volume === 0 ? 'Muted' : `${Math.round(clip.volume * 100)}%`}><AudioProperties clip={clip} project={project}/></PropertySection>}
      {asset && <PropertySection title="Source media" defaultOpen={false}><dl className="inspector-source-details"><div><dt>File</dt><dd>{asset.name}</dd></div>{asset.width && asset.height && <div><dt>Resolution</dt><dd>{asset.width} × {asset.height}</dd></div>}{asset.videoCodec && <div><dt>Codec</dt><dd>{asset.videoCodec.toUpperCase()}</dd></div>}</dl></PropertySection>}
      <button className="delete-clip" disabled={busy} onClick={() => void useEditor.getState().execute([{type: 'clip.remove', id: clip.id}], `Removed ${clip.name}`)}><Trash2 size={14}/> Remove clip <kbd>Del</kbd></button>
    </div>
  </>;
}
