import {useCurrentFrame} from 'remotion';
import type {Clip, Project} from '../../../shared/project';
import {visualGeometryStyle} from '../effects/visual-geometry';
import {visibleCaptionWords} from '../../../shared/text-timing';
export function CaptionLayer({clip, project}: {clip: Clip; project: Project}) {
  const frame = useCurrentFrame() + clip.sourceStart; const caption = clip.caption!;
  const words = visibleCaptionWords(clip);
  return <div data-preview-clip={clip.id} style={{position: 'absolute', left: `${clip.x}%`, top: `${clip.y}%`, transform: `translate(-50%, -50%) rotate(${clip.rotation ?? 0}deg) scale(${clip.scale})`, width: '88%', textAlign: clip.align, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: clip.fontSize, fontWeight: Number(clip.weight), color: clip.color, lineHeight: 1.4, textShadow: '0 2px 8px #000, 0 0 24px #0008', ...visualGeometryStyle(clip, project)}}>
    <span style={{boxDecorationBreak: 'clone', padding: caption.style === 'boxed' ? '12px 24px' : 0, background: caption.style === 'boxed' ? '#080c0eeb' : undefined, borderRadius: 12}}>{words.map((word, i) => <span key={i} style={{color: caption.style === 'highlight' && frame >= word.start && frame < word.end ? caption.highlightColor : clip.color}}>{i ? ' ' : ''}{word.text}</span>)}</span>
  </div>;
}
