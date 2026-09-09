import {GripVertical, Music2, Type} from 'lucide-react';
import {memo, useEffect, useRef, useState, type PointerEvent} from 'react';
import type {Asset, Clip, Command} from '../../../shared/project';
import {acceptsClip, clipTrackId, projectTracks} from '../../../shared/tracks';
import {useEditor} from '../../stores/editor-store';
import {useWorkspace} from '../../stores/workspace-store';

interface Props {clip: Clip; asset?: Asset; pixelsPerFrame: number; top: number}
export const TimelineClip = memo(function TimelineClip({clip, asset, pixelsPerFrame, top}: Props) {
  const fps = useEditor(s => s.snapshot?.project.fps ?? 30);
  const selected = useEditor(s => s.selectedId === clip.id); const busy = useEditor(s => s.busy);
  const tool = useEditor(s => s.timelineTool); const [cutOffset, setCutOffset] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Clip> | null>(null);
  const changed = useRef<Partial<Clip> | null>(null); const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const visible = {...clip, ...draft};
  const startDrag = (event: PointerEvent, mode: 'move' | 'left' | 'right') => {
    if(event.button !== 0 || busy) return; event.stopPropagation(); event.preventDefault();
    // preventDefault stops the browser focusing the clip. Explicit focus leaves
    // the previous inspector/chat input so timeline shortcuts receive the keys.
    event.currentTarget.closest<HTMLElement>('[data-clip-id]')?.focus({preventScroll: true});
    window.getSelection()?.removeAllRanges();
    const project = useEditor.getState().snapshot?.project; if(!project) return;
    if(mode === 'move' && tool === 'razor') {
      const frame = clip.start + Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / pixelsPerFrame);
      void useEditor.getState().splitClip(clip.id, frame); return;
    }
    const originalTrack = clipTrackId(project, clip); let targetTrack = originalTrack;
    useEditor.setState({selectedId: clip.id, selectedTrackId: originalTrack, inspectorTab: 'properties', playing: false});
    const x = event.clientX; const y = event.clientY; changed.current = null;
    const move = (e: globalThis.PointerEvent) => {
      if(!changed.current && Math.hypot(e.clientX - x, e.clientY - y) < 4) return;
      let delta = Math.round((e.clientX - x) / pixelsPerFrame);
      let patch: Partial<Clip>;
      if(mode === 'move') {
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
        const isSource = clip.kind === 'video' || clip.kind === 'audio' || !!clip.caption;
        delta = Math.max(-clip.start, isSource ? -clip.sourceStart : -clip.start, Math.min(delta, clip.duration - 1));
        patch = {start: clip.start + delta, duration: clip.duration - delta, sourceStart: clip.sourceStart + (isSource ? delta : 0), motionOffset: Math.max(0, (clip.motionOffset ?? 0) + delta)};
      } else {
        const maximum = asset && (clip.kind === 'video' || clip.kind === 'audio') ? Math.floor(asset.duration * fps) - clip.sourceStart : 108_000;
        patch = {duration: Math.max(1, Math.min(maximum, clip.duration + delta))};
      }
      changed.current = patch; setDraft(patch);
    };
    const cleanup = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); dragCleanup.current = null; useEditor.setState({dragTargetTrackId: null});};
    const up = () => {cleanup(); const patch = changed.current; const commands: Command[] = [];
      if(mode === 'move' && targetTrack !== originalTrack) commands.push({type: 'clip.move-track', id: clip.id, trackId: targetTrack});
      if(patch && Object.entries(patch).some(([key, value]) => clip[key as keyof Clip] !== value)) commands.push({type: 'clip.update', id: clip.id, patch});
      if(commands.length) void useEditor.getState().execute(commands, mode === 'move' ? `Moved ${clip.name}` : `Trimmed ${clip.name}`, project.revision).then(ok => {if(ok) useEditor.setState({selectedTrackId: targetTrack});}).finally(() => setDraft(null)); else setDraft(null);
    };
    const cancel = () => {cleanup(); setDraft(null);};
    dragCleanup.current?.(); dragCleanup.current = cleanup;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  return <div data-clip-id={clip.id} role="button" tabIndex={0} aria-label={`Select ${clip.name}`} aria-pressed={selected} className={`timeline-clip timeline-clip--${clip.track} ${selected ? 'selected' : ''} ${draft ? 'dragging' : ''} ${tool === 'razor' ? 'timeline-clip--razor' : ''}`} style={{left: visible.start * pixelsPerFrame, width: Math.max(8, visible.duration * pixelsPerFrame), top}} onPointerDown={e => startDrag(e, 'move')} onPointerMove={e => {if(tool === 'razor') setCutOffset(Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / pixelsPerFrame) * pixelsPerFrame);}} onPointerLeave={() => setCutOffset(null)} onKeyDown={e => {if(e.key === 'Enter') {const project = useEditor.getState().snapshot?.project; useEditor.setState({selectedId: clip.id, selectedTrackId: project ? clipTrackId(project, clip) : null, inspectorTab: 'properties', playing: false});}}}>
    {clip.track === 'visual' && asset?.thumbnail && <div className="clip-thumbnails" style={{backgroundImage: `url("${asset.thumbnail}")`}}/>}
    <div className="clip-label">{clip.kind === 'text' ? <Type size={11}/> : clip.kind === 'audio' ? <Music2 size={12}/> : <GripVertical size={12}/>}<span>{clip.kind === 'text' ? clip.text.replaceAll('\n', ' ') : clip.name}</span></div>
    {clip.track === 'audio' && <div className="audio-strip"/>}
    {tool === 'razor' && cutOffset !== null && <span className="razor-guide" style={{left: cutOffset}}/>}
    {(clip.transition !== 'none' || clip.presetTransition) && <span className="clip-transition" title={clip.presetTransition?.definition.name ?? clip.transition} style={{width: Math.max(12, Math.min(clip.transitionFrames, visible.duration) * pixelsPerFrame)}}/>}
    <span className="trim-handle trim-handle--left" role="button" aria-label={`Trim start of ${clip.name}`} onPointerDown={e => startDrag(e, 'left')}/><span className="trim-handle trim-handle--right" role="button" aria-label={`Trim end of ${clip.name}`} onPointerDown={e => startDrag(e, 'right')}/>
  </div>;
});
