import {useTimelineGroupDrag} from '../../hooks/useTimelineGroupDrag';
import {timelineSelection} from '../../services/timeline-selection';
import {GripVertical, Music2, Type} from 'lucide-react';
import {memo, useEffect, useRef, useState, type PointerEvent} from 'react';
import type {Asset, Clip, Command} from '../../../shared/project';
import {acceptsClip, clipTrackId, projectTracks} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {useWorkspace} from '../../stores/workspace-store';
import {maximumSpeed, minimumSpeed, speedClipContext, speedTimeMap} from '../../../shared/speed-ramping';
import {beginSpeedEdit} from '../../services/speed-actions';
import {useSpeedJobs} from '../../stores/speed-store';
import {AudioWaveform} from '../atoms/AudioWaveform';
import {relatedClipIds} from '../../../shared/editorial-tools';

interface Props {clip: Clip; asset?: Asset; pixelsPerFrame: number; top: number}
export const TimelineClip = memo(function TimelineClip({clip, asset, pixelsPerFrame, top}: Props) {
  const fps = useEditor(s => s.snapshot?.project.fps ?? 30);
  const projectId = useEditor(s => s.snapshot?.project.id ?? '');
  const revision = useEditor(s => s.snapshot?.project.revision);
  const selected = useEditor(s => timelineSelection(s).includes(clip.id)); const busy = useEditor(s => s.busy);
  const speedJob = useSpeedJobs(state => state.jobs[`${projectId}:${clip.id}`]);
  const [speedPending, setSpeedPending] = useState(false); const [retimeDraft, setRetimeDraft] = useState(false);
  const retiming = speedPending || speedJob?.status === 'queued' || speedJob?.status === 'processing';
  const tool = useEditor(s => s.timelineTool); const [cutOffset, setCutOffset] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Clip> | null>(null);
  const changed = useRef<Partial<Clip> | null>(null); const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {dragCleanup.current?.(); setDraft(null); setRetimeDraft(false); changed.current = null;}, [projectId, revision]);
  const startGroupDrag = useTimelineGroupDrag();
  const groupDelta = useEditor(s => s.groupDrag?.ids.includes(clip.id) ? s.groupDrag.delta : 0);
  const visible = {...clip, ...draft, ...(groupDelta ? {start: clip.start + groupDelta} : {})};
  const startDrag = (event: PointerEvent, mode: 'move' | 'left' | 'right') => {
    if(event.button !== 0 || busy) return; event.stopPropagation(); event.preventDefault();
    // preventDefault stops the browser focusing the clip. Explicit focus leaves
    // the previous inspector/chat input so timeline shortcuts receive the keys.
    event.currentTarget.closest<HTMLElement>('[data-clip-id]')?.focus({preventScroll: true});
    window.getSelection()?.removeAllRanges();
    const project = useEditor.getState().snapshot?.project; if(!project) return;
    if(retiming) {useEditor.setState({selectedIds: [clip.id], selectedId: clip.id, selectedTrackId: clipTrackId(project, clip), inspectorTab: 'properties'}); return;}
    const retime = mode === 'right' && clip.kind === 'video' && event.ctrlKey;
    const trimMode = useEditor.getState().trimMode;
    let minimumDuration = 1; let maximumDuration = 108_000;
    if(retime) {
      try {
        const context = speedClipContext(project, clip);
        const rates = [context.recipe.speed, ...context.recipe.points.map(point => point.speed)];
        const exactFrames = speedTimeMap(context.recipe, context.sourceDurationSeconds, context.fps).totalSeconds * project.fps;
        minimumDuration = Math.max(1, Math.ceil(exactFrames * rates.reduce((value, rate) => Math.max(value, rate), minimumSpeed) / maximumSpeed));
        maximumDuration = Math.max(minimumDuration, Math.floor(exactFrames * rates.reduce((value, rate) => Math.min(value, rate), maximumSpeed) / minimumSpeed));
      } catch(reason) {useEditor.setState({error: (reason as Error).message}); return;}
    }
    if(mode === 'move' && tool === 'razor') {
      const frame = clip.start + Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / pixelsPerFrame);
      void useEditor.getState().splitClip(clip.id, frame); return;
    }
    if(mode === 'move' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      const current = timelineSelection(useEditor.getState());
      const related = relatedClipIds(project, [clip.id]);
      const ids = current.includes(clip.id) ? current.filter(id => !related.includes(id)) : [...new Set([...current, ...related])];
      useEditor.setState({selectedIds: ids, selectedId: ids[0] ?? null, playing: false}); return;
    }
    if(mode === 'move' && trimMode !== 'slip' && startGroupDrag(event, clip.id, pixelsPerFrame)) return;
    const originalTrack = clipTrackId(project, clip); let targetTrack = originalTrack;
    useEditor.setState({selectedIds: [clip.id], selectedId: clip.id, selectedTrackId: originalTrack, inspectorTab: 'properties', playing: false});
    const x = event.clientX; const y = event.clientY; const pointerId = event.pointerId; changed.current = null;
    const move = (e: globalThis.PointerEvent) => {
      if(e.pointerId !== pointerId) return;
      if(!changed.current && Math.hypot(e.clientX - x, e.clientY - y) < 4) return;
      let delta = Math.round((e.clientX - x) / pixelsPerFrame);
      let patch: Partial<Clip>;
      if(mode === 'move' && trimMode === 'slip' && asset && ['video', 'audio', 'sequence'].includes(clip.kind)) {
        const available = clip.kind === 'sequence' ? Infinity : Math.floor(asset.duration * fps) - clip.duration;
        patch = {sourceStart: Math.max(0, Math.min(available, clip.sourceStart + delta))};
      } else if(mode === 'move') {
        const area = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.track-area[data-track-id]');
        const track = projectTracks(project).find(t => t.id === area?.dataset.trackId);
        targetTrack = track && acceptsClip(track, clip) ? track.id : originalTrack;
        useEditor.setState({dragTargetTrackId: targetTrack});
        let start = Math.max(0, clip.start + delta);
        if(useWorkspace.getState().snapping && !e.altKey) {
          const candidates = [0, useEditor.getState().frame, ...project.clips.filter(c => c.id !== clip.id && clipTrackId(project, c) === targetTrack).flatMap(c => [c.start, c.start + c.duration])];
          for(const target of candidates) {if(Math.abs(start - target) * pixelsPerFrame < 7) {start = target; break;} if(Math.abs(start + clip.duration - target) * pixelsPerFrame < 7) {start = target - clip.duration; break;}}
        }
        patch = {start: Math.max(0, start)};
      } else if(mode === 'left') {
        const isSource = clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'sequence' || !!clip.caption;
        delta = Math.max(-clip.start, isSource ? -clip.sourceStart : -clip.start, Math.min(delta, clip.duration - 1));
        patch = {start: clip.start + delta, duration: clip.duration - delta, sourceStart: clip.sourceStart + (isSource ? delta : 0), motionOffset: (clip.motionOffset ?? 0) + delta};
      } else if(retime) {
        patch = {duration: Math.max(minimumDuration, Math.min(maximumDuration, clip.duration + delta))};
        setRetimeDraft(true);
      } else {
        const maximum = asset && (clip.kind === 'video' || clip.kind === 'audio') ? Math.floor(asset.duration * fps + 1e-7) - clip.sourceStart : 108_000;
        patch = {duration: Math.max(1, Math.min(maximum, clip.duration + delta))};
      }
      changed.current = patch; setDraft(patch);
    };
    const cleanup = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key, true); dragCleanup.current = null; useEditor.setState({dragTargetTrackId: null});};
    const up = (event: globalThis.PointerEvent) => {if(event.pointerId !== pointerId) return; cleanup(); const patch = changed.current; const commands: Command[] = [];
      if(retime) {
        setRetimeDraft(false); setDraft(null);
        if(patch?.duration && patch.duration !== clip.duration) {
          setSpeedPending(true);
          void beginSpeedEdit(project.id, {revision: project.revision, clipId: clip.id, targetDurationFrames: patch.duration}).catch(reason => useEditor.setState({error: (reason as Error).message})).finally(() => setSpeedPending(false));
        }
        return;
      }
      if(patch && mode === 'move' && trimMode === 'slip' && patch.sourceStart !== undefined) commands.push({type: 'clip.slip', id: clip.id, delta: patch.sourceStart - clip.sourceStart, linked: true});
      else if(patch && mode !== 'move') {
        const delta = mode === 'left' ? patch.start! - clip.start : patch.duration! - clip.duration;
        if(delta) commands.push(mode === 'right' && trimMode === 'roll' ? {type: 'clip.roll', id: clip.id, delta} : {type: 'clip.trim', id: clip.id, edge: mode === 'left' ? 'start' : 'end', delta, linked: true, ripple: mode === 'right' && trimMode === 'ripple'});
      } else {
        if(mode === 'move' && targetTrack !== originalTrack) commands.push({type: 'clip.move-track', id: clip.id, trackId: targetTrack});
        if(patch && Object.entries(patch).some(([key, value]) => clip[key as keyof Clip] !== value)) commands.push({type: 'clip.update', id: clip.id, patch});
      }
      if(commands.length) void useEditor.getState().execute(commands, mode === 'move' ? `Moved ${clip.name}` : `Trimmed ${clip.name}`, project.revision).then(ok => {if(ok) useEditor.setState({selectedTrackId: targetTrack});}).finally(() => setDraft(null)); else setDraft(null);
    };
    const cancel = (event?: globalThis.PointerEvent) => {if(event && event.pointerId !== pointerId) return; cleanup(); changed.current = null; setDraft(null); setRetimeDraft(false);};
    const key = (event: KeyboardEvent) => {if(event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancel();}};
    dragCleanup.current?.(); dragCleanup.current = cleanup;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key, true);
  };
  return <div data-clip-id={clip.id} role="button" tabIndex={0} aria-label={`Select ${clip.name}`} aria-pressed={selected} className={`timeline-clip timeline-clip--${clip.track} ${selected ? 'selected' : ''} ${draft ? 'dragging' : ''} ${retimeDraft ? 'timeline-clip--retiming' : ''} ${tool === 'razor' ? 'timeline-clip--razor' : ''}`} style={{left: visible.start * pixelsPerFrame, width: Math.max(8, visible.duration * pixelsPerFrame), top}} onPointerDown={e => startDrag(e, 'move')} onPointerMove={e => {if(tool === 'razor') setCutOffset(Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / pixelsPerFrame) * pixelsPerFrame);}} onPointerLeave={() => setCutOffset(null)} onKeyDown={e => {if(e.key === 'Enter') {const project = useEditor.getState().snapshot?.project; useEditor.setState({selectedIds: [clip.id], selectedId: clip.id, selectedTrackId: project ? clipTrackId(project, clip) : null, inspectorTab: 'properties', playing: false});}}}>
    {clip.track === 'visual' && asset?.thumbnail && <div className="clip-thumbnails" style={{backgroundImage: `url("${asset.thumbnail}")`}}/>}
    <div className="clip-label">{clip.kind === 'text' ? <Type size={11}/> : clip.kind === 'audio' ? <Music2 size={12}/> : <GripVertical size={12}/>}<span>{clip.kind === 'text' ? clip.text.replaceAll('\n', ' ') : clip.name}</span></div>
    {asset && (clip.kind === 'audio' || clip.kind === 'video') && <AudioWaveform assetId={asset.id} sourceKey={asset.src} start={visible.sourceStart / fps} duration={visible.duration / fps}/>}
    {retimeDraft && <span className="clip-retime-hint">{(visible.duration / fps).toFixed(2)} s · {(clip.duration / visible.duration).toFixed(2)}× current</span>}
    {retiming && <span className="clip-retime-hint">{speedJob?.status === 'processing' ? `Retiming ${Math.round(speedJob.progress * 100)}%` : 'Retiming queued…'}</span>}
    {tool === 'razor' && cutOffset !== null && <span className="razor-guide" style={{left: cutOffset}}/>}
    {(clip.transition !== 'none' || clip.presetTransition) && <span className="clip-transition" title={clip.presetTransition?.definition.name ?? clip.transition} style={{width: Math.max(12, Math.min(clip.transitionFrames, visible.duration) * pixelsPerFrame)}}/>}
    <span className="trim-handle trim-handle--left" role="button" aria-label={`Trim start of ${clip.name}`} onPointerDown={e => startDrag(e, 'left')}/><span className="trim-handle trim-handle--right" role="button" aria-label={`Trim end of ${clip.name}`} title={clip.kind === 'video' ? 'Drag to trim · Ctrl-drag to change speed' : 'Drag to trim'} onPointerDown={e => startDrag(e, 'right')}/>
  </div>;
});
