import {Player} from '@remotion/player';
import {Camera, ChevronLeft, ChevronRight, Expand, Film, MousePointer2, Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX} from 'lucide-react';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {durationOf, formatTimecode} from '../../../shared/project';
import {ProjectComposition} from '../../video/ProjectComposition';
import {useEditor} from '../../stores/editor-store';
import {usePreviewTransform} from '../../hooks/usePreviewTransform';
import {PreviewSelection} from '../molecules/PreviewSelection';
import {IconButton} from '../atoms/Button';
import {usePreviewPlayback} from '../../hooks/usePreviewPlayback';
import {useMediaPlaybackSources} from '../../hooks/useMediaPlaybackSources';
import {playbackSourceLabel} from '../../services/preview-quality';
import {MediaPreviewStatus} from '../molecules/MediaPreviewStatus';
import {PlaybackQualitySelect} from '../molecules/PlaybackQualitySelect';

export function Preview() {
  const snapshot = useEditor(s => s.snapshot); const frame = useEditor(s => s.frame); const playing = useEditor(s => s.playing);
  const timelineAssets = useMemo(() => snapshot?.project.assets.filter(asset => snapshot.project.clips.some(clip => clip.assetId === asset.id)) ?? [], [snapshot?.project]);
  const {sources, pendingPreviews, selections, onSourceError} = useMediaPlaybackSources(timelineAssets);
  const [muted, setMuted] = useState(false); const [safe, setSafe] = useState(false);
  const [zoom, setZoom] = useState('fit');
  const canvas = useRef<HTMLDivElement>(null); const [editing, setEditing] = useState(true);
  const transform = usePreviewTransform(canvas, snapshot?.project, frame, editing && !playing);
  const project = snapshot?.project; const draft = transform.draft;
  const previewProject = useMemo(() => project && draft ? {...project, clips: project.clips.map(clip => clip.id === draft.id ? {...clip, ...draft.patch} : clip)} : project, [project, draft]);
  // Remotion restarts its playback clock when inputProps changes. Keep observed frames
  // out of these dependencies so normal playback does not repeatedly reset that clock.
  const inputProps = useMemo(() => previewProject ? {project: previewProject, pendingPreviews, previewSources: sources, onPreviewSourceError: onSourceError} : undefined, [previewProject, pendingPreviews, sources, onSourceError]);
  const stage = useRef<HTMLDivElement>(null); const [canvasWidth, setCanvasWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = stage.current; if(!element) return;
    const style = getComputedStyle(element);
    setCanvasWidth(Math.min(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), (element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) * (snapshot?.project.width ?? 1920) / (snapshot?.project.height ?? 1080)));
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(Math.min(entry.contentRect.width, entry.contentRect.height * (snapshot?.project.width ?? 1920) / (snapshot?.project.height ?? 1080))));
    observer.observe(element); return () => observer.disconnect();
  }, [snapshot?.project.width, snapshot?.project.height]);
  const fps = snapshot?.project.fps ?? 30;
  const {player, playerKey, status, retry} = usePreviewPlayback(`${project?.id}/${project?.width}/${project?.height}/${fps}`, muted);
  const duration = snapshot ? durationOf(snapshot.project) : 30;
  const activeClip = project?.clips.find(clip => clip.kind === 'video' && frame >= clip.start && frame < clip.start + clip.duration);
  const activeAsset = timelineAssets.find(asset => asset.id === activeClip?.assetId);
  const activeSource = selections.find(source => source.assetId === activeAsset?.id);
  return <main className="preview">
    <div className="preview__heading"><div className="preview__identity"><span className="preview__title">Program monitor</span><span className="preview__sequence-name" title={project?.name}>{project?.name || 'Sequence'}</span></div><div className="preview__meta"><IconButton label="Edit elements on canvas" aria-pressed={editing} className={editing ? 'active' : ''} onClick={() => setEditing(!editing)}><MousePointer2 size={15}/></IconButton><IconButton label="Toggle safe area guides" aria-pressed={safe} className={safe ? 'active' : ''} onClick={() => setSafe(!safe)}><Maximize2 size={14}/></IconButton><label className="preview__zoom"><span className="sr-only">Monitor zoom</span><select aria-label="Monitor zoom" value={zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit</option><option value="0.5">50%</option><option value="1">100%</option></select></label></div></div>
    <div className={`preview__stage ${zoom !== 'fit' ? 'preview__stage--zoomed' : ''}`} ref={stage}><div className="preview__canvas" ref={canvas} style={{width: zoom === 'fit' ? canvasWidth : (project?.width ?? 1920) * Number(zoom), aspectRatio: `${snapshot?.project.width ?? 1920}/${snapshot?.project.height ?? 1080}`}}>
      {snapshot && inputProps && <Player key={playerKey} ref={player} component={ProjectComposition} inputProps={inputProps} durationInFrames={duration} compositionWidth={snapshot.project.width} compositionHeight={snapshot.project.height} fps={fps} initialFrame={Math.min(frame, duration - 1)} style={{width: '100%', aspectRatio: `${snapshot.project.width}/${snapshot.project.height}`}} controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense errorFallback={({error}) => <div className="player-error">Preview unavailable<span>{error.message}</span></div>}/>}
      {previewProject && editing && !playing && <PreviewSelection project={previewProject} bounds={transform.bounds} begin={transform.begin}/>}
      {safe && <div className="safe-guides"><span>SAFE AREA</span></div>}
      {status !== 'ready' && <div className="preview__recovery" role="status"><span>{status === 'blocked' ? 'Playback could not resume.' : status === 'recovering' ? 'Reconnecting preview…' : 'Loading video…'}</span><button type="button" onClick={retry}>Reload preview</button></div>}
      {!snapshot?.project.clips.length && <div className="canvas-empty"><Film size={32}/><h3>Your sequence is empty</h3><p>Import footage, then drag it onto a video track.</p></div>}
    </div></div>
    <div className="preview__controls"><span className="timecode">{formatTimecode(frame, fps)} <span>/ {formatTimecode(duration, fps)}</span></span><div className="transport"><IconButton label="Go to beginning" onClick={() => useEditor.getState().seekTo(0)}><SkipBack size={17}/></IconButton><IconButton label="Previous frame" onClick={() => {useEditor.setState({playing: false}); useEditor.getState().seekTo(Math.max(0, frame - 1));}}><ChevronLeft size={17}/></IconButton><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => useEditor.setState({playing: !playing})}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><IconButton label="Next frame" onClick={() => {useEditor.setState({playing: false}); useEditor.getState().seekTo(Math.min(duration - 1, frame + 1));}}><ChevronRight size={17}/></IconButton><IconButton label="Go to end" onClick={() => useEditor.getState().seekTo(duration - 1)}><SkipForward size={17}/></IconButton></div><div className="preview__utilities"><IconButton label="Capture current frame" onClick={() => void useEditor.getState().render('frame')}><Camera size={16}/></IconButton><IconButton label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => {if(muted) player.current?.unmute(); else player.current?.mute(); setMuted(!muted);}}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</IconButton><IconButton label="Fullscreen preview" onClick={() => player.current?.requestFullscreen()}><Expand size={16}/></IconButton></div></div>
    <div className="preview__status"><span className="preview__format" title="Sequence resolution and frame rate">{project?.width ?? 1920} × {project?.height ?? 1080} · {fps} fps</span><span className="preview__source-quality" title="Decoded playback media resolution; monitor zoom does not change export quality">{playbackSourceLabel(activeSource)}</span><PlaybackQualitySelect className="preview__quality"/></div>
    {activeAsset && <div className="preview__preparation"><MediaPreviewStatus asset={activeAsset}/></div>}
  </main>;
}
