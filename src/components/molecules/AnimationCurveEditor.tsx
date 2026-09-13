import {ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut} from 'lucide-react';
import {useMemo, useRef, useState} from 'react';
import type {Clip} from '../../../shared/project';
import {moveAnimationKeys} from '../../../shared/animation-editing';
import {visualEasingCurve, visualPropertyLimits, type VisualKeyframe} from '../../../shared/visual-editing';
import type {AnimationEditor} from '../../hooks/useAnimationEditor';
import {useNormalizedDrag} from '../../hooks/useNormalizedDrag';
import {animationCurvePath, animationValue, fitAnimationCurve, zoomAnimationCurve, type CurveViewport} from '../../services/animation-curve-service';
import {IconButton} from '../atoms/Button';

interface KeyDrag {keys: VisualKeyframe[]; frames: number[]; deltaFrame: number; deltaValue: number; error?: string}
export function AnimationCurveEditor({clip, fps, editor}: {clip: Clip; fps: number; editor: AnimationEditor}) {
  const {property, keys, selected, setSelection, disabled, offset} = editor;
  const initial = useMemo(() => fitAnimationCurve(clip, property), [clip.id, property]);
  const [view, setView] = useState<CurveViewport>(initial); const [draft, setDraft] = useState<VisualKeyframe[] | null>(null);
  const [dragged, setDragged] = useState<KeyDrag | null>(null); const [box, setBox] = useState<{x: number; y: number; width: number; height: number} | null>(null);
  const [snap, setSnap] = useState(true); const didDrag = useRef(false);
  const svg = useRef<SVGSVGElement>(null); const begin = useNormalizedDrag(svg, clip);
  const working = draft ?? dragged?.keys ?? keys; const selection = dragged?.frames ?? selected;
  const width = view.end - view.start; const height = view.high - view.low;
  const x = (frame: number) => (frame - view.start) / width * 1000;
  const y = (value: number) => (view.high - value) / height * 300;
  const at = (point: {x: number; y: number}) => ({frame: view.start + point.x / 100 * width, value: view.high - point.y / 100 * height});
  const path = useMemo(() => animationCurvePath(working, clip[property] ?? 0, view, property), [working, clip, property, view]);
  const primary = working.find(key => key.frame === selection[0]); const index = primary ? working.indexOf(primary) : -1; const next = working[index + 1];
  const curve = primary?.easing === 'linear' ? {x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3} : primary ? visualEasingCurve(primary) : null;
  const handles = primary && next && curve && primary.easing !== 'hold' && primary.value !== next.value ? ([1, 2] as const).map(i => ({i, frame: primary.frame + (next.frame - primary.frame) * curve[`x${i}`], value: primary.value + (next.value - primary.value) * curve[`y${i}`]})) : [];
  const pan = (fraction: number) => setView({...view, start: view.start + width * fraction, end: view.end + width * fraction});
  return <div className="animation-curve">
    <div className="animation-curve__toolbar">
      <IconButton label="Zoom into animation curve" onClick={() => setView(zoomAnimationCurve(view, .5, editor.frame))}><ZoomIn size={13}/></IconButton>
      <IconButton label="Zoom out of animation curve" onClick={() => setView(zoomAnimationCurve(view, 2, editor.frame))}><ZoomOut size={13}/></IconButton>
      <IconButton label="Pan animation earlier" onClick={() => pan(-.4)}><ChevronLeft size={13}/></IconButton>
      <IconButton label="Pan animation later" onClick={() => pan(.4)}><ChevronRight size={13}/></IconButton>
      <IconButton label="Fit clip animation" onClick={() => setView(fitAnimationCurve(clip, property))}><Maximize2 size={13}/></IconButton>
      <button type="button" onClick={() => setView(fitAnimationCurve(clip, property, true))}>Fit all keys</button>
      <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)}/> Snap</label>
    </div>
    <div className="animation-curve__labels"><span>{animationValue(property, view.high)}</span><span>{selection.length} selected</span></div>
    <svg ref={svg} viewBox="0 0 1000 300" preserveAspectRatio="none" aria-label={`${property} animation curve`} onPointerDown={event => {
      svg.current?.closest<HTMLElement>('[data-animation-editor]')?.focus(); didDrag.current = false;
      if(event.altKey) {
        begin(event, (point, start) => ({...view, start: view.start - (point.x - start.x) / 100 * width, end: view.end - (point.x - start.x) / 100 * width, low: view.low + (point.y - start.y) / 100 * height, high: view.high + (point.y - start.y) / 100 * height}), value => {if(value) {didDrag.current = true; setView(value);}}, () => {});
      } else {
        const previous = event.shiftKey ? selected : [];
        begin(event, (point, start) => ({x: Math.min(point.x, start.x) * 10, y: Math.min(point.y, start.y) * 3, width: Math.abs(point.x - start.x) * 10, height: Math.abs(point.y - start.y) * 3}), value => {if(value) didDrag.current = true; setBox(value);}, area => {
          setSelection([...new Set([...previous, ...keys.filter(key => x(key.frame) >= area.x && x(key.frame) <= area.x + area.width && y(key.value) >= area.y && y(key.value) <= area.y + area.height).map(key => key.frame)])]);
        });
      }
    }} onClick={event => {
      if(didDrag.current || event.altKey) return;
      const bounds = event.currentTarget.getBoundingClientRect(); const frame = Math.round(view.start + (event.clientX - bounds.left) / bounds.width * width);
      setSelection([]); editor.seek(Math.max(offset, Math.min(offset + clip.duration - 1, frame)));
    }} onDoubleClick={event => {
      if(disabled) return; const bounds = event.currentTarget.getBoundingClientRect(); const point = at({x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100});
      const [min, max] = visualPropertyLimits[property]; void editor.add(Math.max(0, Math.round(point.frame)), Math.max(min, Math.min(max, point.value)));
    }}>
      <rect className="animation-curve__outside" x="0" y="0" width={Math.max(0, Math.min(1000, x(offset)))} height="300"/>
      <rect className="animation-curve__outside" x={Math.max(0, x(offset + clip.duration - 1))} y="0" width={Math.max(0, 1000 - x(offset + clip.duration - 1))} height="300"/>
      <path className="animation-curve__grid" d="M0 75H1000M0 150H1000M0 225H1000M250 0V300M500 0V300M750 0V300"/>
      <path className="animation-curve__line" d={path}/><path className="animation-curve__playhead" d={`M${x(editor.frame)} 0V300`}/>
      {handles.map(handle => <g key={handle.i} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <path className="bezier-editor__guides" d={`M${x(handle.i === 1 ? primary!.frame : next!.frame)} ${y(handle.i === 1 ? primary!.value : next!.value)}L${x(handle.frame)} ${y(handle.value)}`}/>
        <circle className="animation-curve__tangent" cx={x(handle.frame)} cy={y(handle.value)} r="7" role="button" aria-label={`Curve Bezier handle ${handle.i}`} onPointerDown={event => {
          event.stopPropagation(); if(disabled) return;
          begin(event, point => {
            const target = at(point); const bezier = {...curve!, [`x${handle.i}`]: Math.max(0, Math.min(1, (target.frame - primary!.frame) / (next!.frame - primary!.frame))), [`y${handle.i}`]: (target.value - primary!.value) / (next!.value - primary!.value)};
            return {...primary!, easing: 'bezier' as const, bezier};
          }, value => setDraft(value ? keys.map(key => key.frame === value.frame ? value : key) : null), value => {void editor.changeKey(primary!, value);});
        }}/>
      </g>)}
      {working.filter(key => key.frame >= view.start && key.frame <= view.end).map(key => <circle key={key.frame} className={`animation-curve__key ${selection.includes(key.frame) ? 'animation-curve__key--selected' : ''}`} cx={x(key.frame)} cy={y(key.value)} r="7" role="button" aria-label={`Move animation key at frame ${key.frame - offset}`} onClick={event => event.stopPropagation()} onDoubleClick={event => {event.stopPropagation(); editor.seek(key.frame);}} onPointerDown={event => {
        event.stopPropagation(); svg.current?.closest<HTMLElement>('[data-animation-editor]')?.focus();
        const chosen = event.shiftKey ? selected.includes(key.frame) ? selected.filter(frame => frame !== key.frame) : [...selected, key.frame] : selected.includes(key.frame) ? selected : [key.frame];
        setSelection(chosen); if(disabled || !chosen.includes(key.frame)) return;
        const snapTargets = [editor.frame, offset, offset + clip.duration - 1, ...keys.filter(key => !chosen.includes(key.frame)).map(key => key.frame)];
        begin(event, (point, start) => {
          let deltaFrame = Math.round((point.x - start.x) / 100 * width); const deltaValue = -(point.y - start.y) / 100 * height;
          if(snap) {const target = key.frame + deltaFrame; const nearest = snapTargets.reduce((a, b) => Math.abs(a - target) < Math.abs(b - target) ? a : b); if(Math.abs(nearest - target) <= width * .008) deltaFrame = Math.round(nearest - key.frame);}
          deltaFrame = Math.max(deltaFrame, -Math.min(...chosen));
          try {return {...moveAnimationKeys(keys, chosen, deltaFrame, deltaValue, property), deltaFrame, deltaValue};}
          catch(error) {return {keys, frames: chosen, deltaFrame, deltaValue, error: (error as Error).message};}
        }, setDragged, value => {
          if(value.error) {editor.setError(value.error); return;}
          void editor.commit([{action: 'move', property, frames: chosen, deltaFrame: value.deltaFrame, deltaValue: value.deltaValue}]).then(ok => {if(ok) setSelection(value.frames);});
        });
      }}/>) }
      {box && <rect className="animation-curve__marquee" {...box}/>}
    </svg>
    <div className="animation-curve__labels"><span>{animationValue(property, view.low)}</span><span>{((view.start - offset) / fps).toFixed(2)} → {((view.end - offset) / fps).toFixed(2)} s</span></div>
    <p className="animation-curve__hint">Double-click to add · Shift-click or drag a box to select · Alt-drag to pan · shaded time is outside the clip</p>
    {dragged?.error && <p className="geometry-error">{dragged.error}</p>}
  </div>;
}
