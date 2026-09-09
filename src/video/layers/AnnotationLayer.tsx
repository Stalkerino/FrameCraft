import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Clip} from '../../../shared/project';
export function AnnotationLayer({clip, width: canvasWidth, height: canvasHeight}: {clip: Clip; width: number; height: number}) {
  const frame = useCurrentFrame() + (clip.motionOffset ?? 0); const shape = clip.annotation!;
  const {fps} = useVideoConfig();
  const progress = clip.animation === 'none' ? 1 : Math.min(1, frame / (fps * .4));
  const stroke = shape.stroke; const width = canvasWidth * shape.width / 100; const height = canvasHeight * shape.height / 100; const margin = stroke * 2;
  const common = {stroke: clip.color, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  return <svg data-preview-clip={clip.id} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', left: `${clip.x}%`, top: `${clip.y}%`, overflow: 'visible', opacity: progress, transform: `translate(-50%, -50%) rotate(${shape.rotation}deg) scale(${clip.scale * (.9 + .1 * progress)})`, filter: 'drop-shadow(0 2px 5px #0008)'}}>
    {shape.shape === 'box' ? <rect x={margin} y={margin} width={Math.max(1, width - margin * 2)} height={Math.max(1, height - margin * 2)} rx={16} {...common}/> : shape.shape === 'circle' ? <ellipse cx={width / 2} cy={height / 2} rx={Math.max(1, width / 2 - margin)} ry={Math.max(1, height / 2 - margin)} {...common}/> : <path d={`M ${margin} ${height / 2} H ${width - margin} M ${width - margin - Math.min(height / 3, width / 3)} ${height / 2 - Math.min(height / 3, width / 3)} L ${width - margin} ${height / 2} L ${width - margin - Math.min(height / 3, width / 3)} ${height / 2 + Math.min(height / 3, width / 3)}`} {...common}/>}
  </svg>;
}
