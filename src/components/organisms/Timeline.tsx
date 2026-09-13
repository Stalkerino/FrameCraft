import {insertSequence} from '../../services/sequence-actions';
import {sequenceSource} from '../../../shared/project-sequences';
import {SequencesDialog} from './SequencesDialog';
import {TimelineMarkers} from '../molecules/TimelineMarkers';
import {MarkersDialog} from './MarkersDialog';
import {useTimelineScrub} from '../../hooks/useTimelineScrub';
import {useTimelineMarquee} from '../../hooks/useTimelineMarquee';
import {timelineSelection} from '../../services/timeline-selection';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {durationOf, formatTime} from '../../../shared/project';
import {projectTracks, trackClips} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {TimelineClip} from '../molecules/TimelineClip';
import {TrackHeader} from '../molecules/TrackHeader';
import {TimelineToolbar} from '../molecules/TimelineToolbar';
import {TrackSettingsDialog} from './TrackSettingsDialog';
import {ClearTrackDialog} from './ClearTrackDialog';
import {useWorkspace} from '../../stores/workspace-store';
import {useTimelineFollowPlayhead} from '../../hooks/useTimelineFollowPlayhead';
import {TimelineContextMenu} from '../molecules/TimelineContextMenu';
import {dropAssetPreset} from '../../services/preset-drop-service';

const LABEL_WIDTH = 196;
export function Timeline() {
  const snapshot = useEditor(s => s.snapshot); const frame = useEditor(s => s.frame); const zoom = useEditor(s => s.zoom); const selectedTrackId = useEditor(s => s.selectedTrackId); const dragTarget = useEditor(s => s.dragTargetTrackId); const busy = useEditor(s => s.busy);
  const selectionCount = useEditor(s => timelineSelection(s).length);
  const playing = useEditor(s => s.playing); const follow = useWorkspace(s => s.followPlayhead);
  const [sequencesDialog, setSequencesDialog] = useState(false);
  const [markerDialog, setMarkerDialog] = useState<{id?: string} | null>(null);
  const [context, setContext] = useState<{clipId: string; x: number; y: number} | null>(null);
  const closeContext = useCallback(() => setContext(null), []);
  const [settingsId, setSettingsId] = useState<string | null>(null); const [clearId, setClearId] = useState<string | null>(null); const scroll = useRef<HTMLDivElement>(null); const project = snapshot?.project;
  useEffect(() => {setSettingsId(null); setClearId(null); setMarkerDialog(null); setSequencesDialog(false); setContext(null); if(scroll.current) scroll.current.scrollLeft = 0;}, [project?.id, project?.sequenceId]);
  const fps = project?.fps ?? 30; const tick = Math.round(fps * 2 * Math.max(1, Math.ceil(1 / zoom))); const ppf = 48 / fps * zoom; const duration = project ? durationOf(project) : 540;
  const width = Math.max(900, (Math.max(duration, ...(project?.markers ?? []).map(m => m.end ?? m.frame)) + Math.round(fps * 3)) * ppf); const tracks = project ? projectTracks(project) : [];
  useTimelineFollowPlayhead(scroll, frame * ppf, LABEL_WIDTH, playing, follow);
  const rows = useMemo(() => tracks.map(track => {
    const clips = trackClips(project!, track.id); const ends: number[] = [];
    const slots = clips.map(clip => {let lane = ends.findIndex(end => end <= clip.start); if(lane < 0) lane = ends.length; ends[lane] = clip.start + clip.duration; return {clip, lane};});
    const itemHeight = track.type === 'visual' ? 58 : 25;
    return {...track, clips, slots, itemHeight, height: Math.max(track.type === 'visual' ? 84 : 66, ends.length * (itemHeight + 4) + 16)};
  }), [project]);
  useEffect(() => {const row = Array.from(scroll.current?.querySelectorAll<HTMLElement>('.timeline-row') ?? []).find(row => row.dataset.trackId === selectedTrackId); row?.scrollIntoView({block: 'nearest', inline: 'nearest'});}, [tracks.length, selectedTrackId]);
  const timelineFrame = (clientX: number) => Math.max(0, Math.round((clientX - (scroll.current?.getBoundingClientRect().left || 0) + (scroll.current?.scrollLeft || 0) - LABEL_WIDTH) / ppf));
  const seek = (clientX: number) => {
    const target = Math.min(duration - 1, timelineFrame(clientX));
    const state = useEditor.getState();
    if(state.frame !== target || state.playing) state.seekTo(target);
  };
  const scrub = useTimelineScrub(seek);
  const marquee = useTimelineMarquee(scroll, seek, project?.revision, project?.id);
  const fit = () => useEditor.setState({zoom: Math.max(.01, Math.min(4, ((scroll.current?.clientWidth ?? 1440) - LABEL_WIDTH) / ((duration / fps + 3) * 48)))});
  return <section className="timeline" aria-label="Video timeline" onContextMenu={event => {const target = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-id]'); if(!target?.dataset.clipId || !project) return; event.preventDefault(); const clip = project.clips.find(c => c.id === target.dataset.clipId); if(!clip) return; useEditor.setState({selectedIds: timelineSelection(useEditor.getState()).includes(clip.id) ? [...timelineSelection(useEditor.getState())] : [clip.id], selectedId: clip.id, selectedTrackId: clip.trackId ?? clip.track, playing: false}); setContext({clipId: clip.id, x: event.clientX, y: event.clientY});}} tabIndex={-1} onPointerDownCapture={event => {if(event.target instanceof Element && !event.target.closest('button, input, select, [data-clip-id]')) event.currentTarget.focus({preventScroll: true});}}><TimelineToolbar project={project} onFit={fit} onSequences={() => setSequencesDialog(true)} onMarkers={() => setMarkerDialog({})}/>
    {sequencesDialog && <SequencesDialog onClose={() => setSequencesDialog(false)}/>}
    <div className="timeline-scroll" ref={scroll}><div className="timeline-content" onPointerDown={marquee.start} style={{width: width + LABEL_WIDTH, minWidth: '100%'}}>
      <div className="timeline-ruler"><div className="track-label ruler-label">TRACKS <span>{fps} FPS</span></div><div className="ruler-area" style={{width}} {...scrub}>{Array.from({length: Math.ceil(width / (tick * ppf))}, (_, i) => <span key={i} className="ruler-tick" style={{left: i * tick * ppf}}>{formatTime(i * tick, fps)}</span>)}</div></div>
      <TimelineMarkers markers={project?.markers ?? []} fps={fps} width={width} pixelsPerFrame={ppf} onEdit={id => setMarkerDialog({id})}/>
      {rows.map(row => <div key={row.id} data-track-id={row.id} className={`timeline-row timeline-row--${row.type} ${row.hidden ? 'timeline-row--hidden' : ''} ${dragTarget === row.id ? 'timeline-row--target' : ''}`} style={{height: row.height}}><TrackHeader track={row} count={row.clips.length} selected={selectedTrackId === row.id} busy={busy} onClear={() => {useEditor.setState({playing: false, error: null}); setClearId(row.id);}} onSelect={() => useEditor.setState({selectedTrackId: row.id, selectedId: null})} onSettings={() => setSettingsId(row.id)}/><div className="track-area" data-track-id={row.id} data-track-type={row.type} style={{width, backgroundSize: `${tick * ppf}px 100%`}} onDragOver={e => {if(e.dataTransfer.types.some(type => ['application/framecraft-asset', 'application/framecraft-preset', 'application/framecraft-sequence'].includes(type))) e.preventDefault();}} onDrop={e => {
        const sequence = e.dataTransfer.getData('application/framecraft-sequence'); if(sequence) {e.preventDefault(); void insertSequence(sequence, timelineFrame(e.clientX), row.id); return;}
        const preset = e.dataTransfer.getData('application/framecraft-preset'); if(preset) {e.preventDefault(); const target = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id]'); void dropAssetPreset(preset, row.id, timelineFrame(e.clientX), target?.dataset.clipId); return;}
        const id = e.dataTransfer.getData('application/framecraft-asset'); const asset = project?.assets.find(a => a.id === id); if(asset) {e.preventDefault(); if((asset.kind === 'audio' ? 'audio' : 'visual') !== row.type) {useEditor.setState({notice: 'Drop media onto a matching video or audio track.'}); return;} useEditor.getState().addAsset(asset, timelineFrame(e.clientX), row.id);}
      }}>{row.slots.map(({clip, lane}) => <TimelineClip key={clip.id} clip={clip} asset={project ? sequenceSource(project, clip) : undefined} pixelsPerFrame={ppf} top={8 + lane * (row.itemHeight + 4)}/>)}{!row.clips.length && <span className="track-placeholder">{row.type === 'audio' ? 'Drop audio here' : row.type === 'text' ? 'Add text or graphics here' : 'Drop footage or graphics here'}</span>}</div></div>)}
      {marquee.rectangle && <div className="timeline-marquee" aria-hidden="true" style={marquee.rectangle}/>}
      {!rows.length && <p className="timeline-empty">Add a track to begin.</p>}
      <div className="playhead" style={{left: LABEL_WIDTH + frame * ppf, height: rows.reduce((sum, r) => sum + r.height, project?.markers?.length ? 50 : 30)}}><div className="playhead__handle" {...scrub}/></div>
    </div></div><div className="timeline-footer"><span><span className="status-dot"/> Local workspace <span className="footer-separator">/</span> Autosave enabled{selectionCount > 1 && <strong className="timeline-selection-count"> · {selectionCount} clips selected</strong>}</span><span><kbd>Space</kbd> Play / pause <span className="footer-separator">·</span><kbd>C</kbd> Cut · <kbd>V</kbd> Select · <kbd>S</kbd> Split <span className="footer-separator">·</span><kbd>Ctrl C / V / D</kbd> Copy / paste / duplicate · <kbd>Ctrl Z / Y</kbd> Undo / redo</span><span>{formatTime(duration, fps)} total</span></div>{markerDialog && <MarkersDialog initialId={markerDialog.id} onClose={() => setMarkerDialog(null)}/>} {settingsId && <TrackSettingsDialog id={settingsId} onClose={() => setSettingsId(null)}/>} {clearId && <ClearTrackDialog id={clearId} onClose={() => setClearId(null)}/>} {context && <TimelineContextMenu {...context} onClose={closeContext}/>}</section>;
}
