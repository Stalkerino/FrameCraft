import {AbsoluteFill, Html5Audio, Img, Sequence, getRemotionEnvironment, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {useMemo} from 'react';
import type {Clip, Project} from '../../shared/project';
import {transitions} from './effects/registry';
import {zoomAtFrame} from '../../shared/clip-animation';
import {CaptionLayer} from './layers/CaptionLayer';
import {AnnotationLayer} from './layers/AnnotationLayer';
import {GraphicLayer} from './assets/GraphicLayer';
import {PresetArtwork} from './assets/PresetArtwork';
import {presetRevealStyle} from './assets/preset-reveal';
import {projectTracks, trackClips} from '../../shared/tracks';
import {TimelineVideo} from './layers/TimelineVideo';
import type {OverlayRenderPass} from '../../shared/layered-render-plan';
import {audioEnvelopeGain} from '../../shared/audio-envelope';
import {ColorGradeFilter} from './layers/ColorGradeFilter';
import {visualStateAtFrame} from '../../shared/visual-editing';
import {visualGeometryStyle} from './effects/visual-geometry';

export interface CompositionProps extends Record<string, unknown> {project: Project; mediaBase?: string; pendingPreviews?: string[]; previewSources?: Record<string, string>; onPreviewSourceError?: (assetId: string) => void; overlayPass?: OverlayRenderPass; output?: {width: number; height: number; fit: 'contain' | 'cover' | 'stretch'}}
interface VisualProps {clip: Clip; project: Project; mediaBase: string; muted?: boolean; opaque?: boolean; pending?: boolean; previewSource?: string; onPreviewSourceError?: (assetId: string) => void}
function useClipVolume(clip: Clip, masterVolume: number): number | ((frame: number) => number) {
  return useMemo(() => clip.audioEnvelope ? (frame: number) => clip.volume * masterVolume * audioEnvelopeGain(clip.audioEnvelope, frame) : clip.volume * masterVolume, [clip.audioEnvelope, clip.volume, masterVolume]);
}
function AudioLayer({clip, src, muted, masterVolume}: {clip: Clip; src: string; muted: boolean; masterVolume: number}) {
  const volume = useClipVolume(clip, masterVolume);
  return <Html5Audio src={src} trimBefore={clip.sourceStart} pauseWhenBuffering volume={volume} muted={muted}/>;
}
function TextLayer({clip, project}: {clip: Clip; project: Project}) {
  const frame = useCurrentFrame() + (clip.motionOffset ?? 0);
  const {fps} = useVideoConfig();
  const progress = interpolate(frame, [0, fps / 2], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const translateX = clip.align === 'center' ? '-50%' : clip.align === 'right' ? '-100%' : '0%';
  return <div data-preview-clip={clip.id} style={{position: 'absolute', left: `${clip.x}%`, top: `${clip.y}%`, transform: `translate(${translateX}, ${clip.animation === 'rise' ? (1 - progress) * 25 : 0}px) rotate(${clip.rotation ?? 0}deg) scale(${clip.scale})`, transformOrigin: `${clip.align} top`, opacity: clip.animation === 'rise' ? progress : 1, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: clip.fontSize, fontWeight: Number(clip.weight), color: clip.color, textAlign: clip.align, whiteSpace: 'pre', lineHeight: 1.02, letterSpacing: clip.fontSize > 60 ? '-0.045em' : '.14em', textShadow: '0 2px 24px #00000040', ...visualGeometryStyle(clip, project)}}>
    {clip.animation === 'typewriter' ? clip.text.slice(0, Math.floor(frame / fps * 45)) : clip.text}
  </div>;
}
function VisualLayer({clip, project, mediaBase, muted = false, opaque = true, pending = false, previewSource, onPreviewSourceError}: VisualProps) {
  const frame = useCurrentFrame();
  clip = {...clip, ...visualStateAtFrame(clip, frame)};
  const volume = useClipVolume(clip, project.masterVolume ?? 1);
  const asset = project.assets.find(a => a.id === clip.assetId); if(!asset && !clip.graphic) return null;
  const src = asset ? mediaBase + (getRemotionEnvironment().isPlayer ? previewSource || asset.src : asset.src) : '';
  const style = {width: '100%', height: '100%', objectFit: 'contain' as const, transform: `translate(${clip.x - 50}%, ${clip.y - 50}%) rotate(${clip.rotation ?? 0}deg) scale(${clip.scale * zoomAtFrame(clip, frame)})`, transformOrigin: `${clip.zoom?.x ?? 50}% ${clip.zoom?.y ?? 50}%`, ...visualGeometryStyle(clip, project)};
  const progress = Math.min(1, frame / Math.max(1, Math.min(clip.transitionFrames, clip.duration) - 1));
  const preset = clip.presetTransition;
  return <AbsoluteFill style={{opacity: clip.opacity ?? 1}}><AbsoluteFill style={{backgroundColor: opaque ? project.backgroundColor ?? '#080c0e' : undefined, ...(preset ? presetRevealStyle(preset.definition.reveal, progress) : transitions[clip.transition].style(progress))}}>
    {pending && getRemotionEnvironment().isPlayer ? <>
      {asset?.thumbnail && <ColorGradeFilter clip={clip.colorGrade} project={project.colorGrade}><Img data-preview-clip={clip.id} src={mediaBase + asset.thumbnail} style={style}/></ColorGradeFilter>}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', background: '#080c0eaa', color: '#fff', fontFamily: 'Arial', fontSize: project.width / 45, textAlign: 'center', padding: '8%'}}>Preparing playback media.<br/>Quality and progress are shown below the monitor.</AbsoluteFill>
    </> : clip.kind === 'graphic' ? <GraphicLayer clip={clip} project={project}/> : <ColorGradeFilter clip={clip.colorGrade} project={project.colorGrade}>{clip.kind === 'image' ? <Img data-preview-clip={clip.id} src={src} style={style}/> : <TimelineVideo clipId={clip.id} src={src} sourceStart={clip.sourceStart} volume={volume} muted={muted} style={style} onUnsupportedSource={asset && src === mediaBase + asset.src && onPreviewSourceError ? () => onPreviewSourceError(asset.id) : undefined}/>}</ColorGradeFilter>}
  </AbsoluteFill>{preset && progress < 1 && <AbsoluteFill><PresetArtwork definition={preset.definition} values={preset.values} progress={progress} width={project.width} height={project.height}/></AbsoluteFill>}</AbsoluteFill>;
}
function OverlayLayer({clip, project}: {clip: Clip; project: Project}) {
  const frame = useCurrentFrame(); const evaluated = {...clip, ...visualStateAtFrame(clip, frame)};
  return <AbsoluteFill style={{opacity: evaluated.opacity ?? 1}}>{clip.kind === 'graphic' ? <GraphicLayer clip={evaluated} project={project}/> : clip.kind === 'annotation' ? <AnnotationLayer clip={evaluated} width={project.width} height={project.height}/> : clip.caption ? <CaptionLayer clip={evaluated} project={project}/> : <TextLayer clip={evaluated} project={project}/>}</AbsoluteFill>;
}
export function ProjectComposition({project, mediaBase = '', output, pendingPreviews, previewSources, onPreviewSourceError, overlayPass}: CompositionProps) {
  if(!output) return <ProjectScene project={project} mediaBase={mediaBase} pendingPreviews={pendingPreviews} previewSources={previewSources} onPreviewSourceError={onPreviewSourceError} overlayPass={overlayPass}/>;
  const sx = output.width / project.width; const sy = output.height / project.height;
  const scale = output.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return <AbsoluteFill style={{background: overlayPass ? 'transparent' : project.backgroundColor ?? '#080c0e', overflow: 'hidden'}}><div style={{position: 'absolute', left: '50%', top: '50%', width: project.width, height: project.height, transform: `translate(-50%, -50%) scale(${output.fit === 'stretch' ? `${sx}, ${sy}` : scale})`}}><ProjectScene project={project} mediaBase={mediaBase} pendingPreviews={pendingPreviews} previewSources={previewSources} onPreviewSourceError={onPreviewSourceError} overlayPass={overlayPass}/></div></AbsoluteFill>;
}
function ProjectScene({project, mediaBase = '', pendingPreviews = [], previewSources, onPreviewSourceError, overlayPass}: CompositionProps) {
  const tracks = [...projectTracks(project)].filter(track => !track.hidden).reverse();
  const bottomVisual = tracks.find(track => track.type === 'visual')?.id;
  return <AbsoluteFill style={{background: overlayPass ? 'transparent' : project.backgroundColor ?? '#080c0e', overflow: 'hidden'}}>
    {tracks.flatMap(track => {
      if(track.id === overlayPass?.omitTrackId) return [];
      const clips = trackClips(project, track.id);
      return clips.map((clip, index) => {
        if(track.type === 'visual') {
          const next = clips[index + 1];
          // Transitions hold only the preceding clip on this same track.
          const hold = next && next.start === clip.start + clip.duration && (next.transition !== 'none' || next.presetTransition) ? Math.min(next.transitionFrames, next.duration) : 0;
          return <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration + hold} premountFor={getRemotionEnvironment().isPlayer ? Math.round(project.fps) : 0}><HeldVisual clip={clip} project={project} mediaBase={mediaBase} muted={track.muted} opaque={track.id === bottomVisual} pending={!!clip.assetId && pendingPreviews.includes(clip.assetId)} previewSource={clip.assetId ? previewSources?.[clip.assetId] : undefined} onPreviewSourceError={onPreviewSourceError}/></Sequence>;
        }
        if(track.type === 'text') return <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration}><OverlayLayer clip={clip} project={project}/></Sequence>;
        const asset = project.assets.find(a => a.id === clip.assetId);
        return asset ? <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration}><AudioLayer clip={clip} src={mediaBase + asset.src} muted={track.muted} masterVolume={project.masterVolume ?? 1}/></Sequence> : null;
      });
    })}
  </AbsoluteFill>;
}
import {Freeze} from 'remotion';
function HeldVisual(props: VisualProps) {
  const frame = useCurrentFrame();
  return frame >= props.clip.duration ? <Freeze frame={props.clip.duration - 1}><VisualLayer {...props} muted/></Freeze> : <VisualLayer {...props}/>;
}
