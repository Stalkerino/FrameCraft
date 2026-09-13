import {useCurrentFrame} from 'remotion';
import type {Clip, Project} from '../../../shared/project';
import {zoomAtFrame} from '../../../shared/clip-animation';
import {PresetArtwork} from './PresetArtwork';
import {visualGeometryStyle} from '../effects/visual-geometry';
import {presetFrameDenominator} from '../../../shared/gpu-artwork';
export function GraphicLayer({clip, project}: {clip: Clip; project: Project}) {
  const frame = useCurrentFrame(); const instance = clip.graphic; if(!instance) return null;
  const progress = Math.max(0, Math.min(1, (frame + (clip.motionOffset ?? 0)) / presetFrameDenominator(instance.duration, project.fps)));
  return <div data-preview-clip={clip.id} style={{position: 'absolute', inset: 0, transform: `translate(${clip.x - 50}%, ${clip.y - 50}%) rotate(${clip.rotation ?? 0}deg) scale(${clip.scale * zoomAtFrame(clip, frame)})`, transformOrigin: `${clip.zoom?.x ?? 50}% ${clip.zoom?.y ?? 50}%`, ...visualGeometryStyle(clip, project)} }><PresetArtwork definition={instance.definition} values={instance.values} progress={progress} width={project.width} height={project.height}/></div>;
}
