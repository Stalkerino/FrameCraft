import {useCurrentFrame} from 'remotion';
import type {Clip} from '../../../shared/project';
export function CaptionLayer({clip}: {clip: Clip}) {
  const frame = useCurrentFrame() + clip.sourceStart; const caption = clip.caption!;
  const words = caption.words.filter(w => w.end > clip.sourceStart && w.start < clip.sourceStart + clip.duration);
  return <div data-preview-clip={clip.id} style={{position: 'absolute', left: `${clip.x}%`, top: `${clip.y}%`, transform: `translate(-50%, -50%) scale(${clip.scale})`, width: '88%', textAlign: clip.align, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: clip.fontSize, fontWeight: Number(clip.weight), color: clip.color, lineHeight: 1.4, textShadow: '0 2px 8px #000, 0 0 24px #0008'}}>
    <span style={{boxDecorationBreak: 'clone', padding: caption.style === 'boxed' ? '12px 24px' : 0, background: caption.style === 'boxed' ? '#080c0eeb' : undefined, borderRadius: 12}}>{words.map((word, i) => <span key={i} style={{color: caption.style === 'highlight' && frame >= word.start && frame < word.end ? caption.highlightColor : clip.color}}>{i ? ' ' : ''}{word.text}</span>)}</span>
  </div>;
}
