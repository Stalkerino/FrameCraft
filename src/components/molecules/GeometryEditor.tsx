import {useId, useRef, useState} from 'react';
import type {Crop, Mask} from '../../../shared/visual-editing';
import {useNormalizedDrag} from '../../hooks/useNormalizedDrag';

type Props = {source?: string; aspectRatio: number; disabled?: boolean; revision: unknown; selectedPoint?: number; onSelectPoint?: (index: number) => void} & (
  {mode: 'crop'; value: Crop; onCommit: (value: Crop) => void} | {mode: 'mask'; value: Mask; onCommit: (value: Mask) => void});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Normalized geometry guide. The program monitor remains the composited result. */
export function GeometryEditor(props: Props) {
  const svg = useRef<SVGSVGElement>(null); const begin = useNormalizedDrag(svg, props.revision);
  const [draft, setDraft] = useState<Crop | Mask | null>(null); const id = useId().replaceAll(':', '');
  const value = draft ?? props.value;
  const crop = props.mode === 'crop' ? value as Crop : null; const mask = props.mode === 'mask' ? value as Mask : null;
  const bounds = crop ? {left: crop.left, top: crop.top, right: 100 - crop.right, bottom: 100 - crop.bottom}
    : {left: mask!.x - mask!.width / 2, right: mask!.x + mask!.width / 2, top: mask!.y - mask!.height / 2, bottom: mask!.y + mask!.height / 2};
  const commit = (next: Crop | Mask) => {if(props.mode === 'crop') props.onCommit(next as Crop); else props.onCommit(next as Mask);};
  const resize = (event: React.PointerEvent, handle: string) => {
    if(props.disabled) return;
    const original = {...bounds};
    begin(event, (point, start) => {
      let {left, right, top, bottom} = original;
      if(handle === 'move') {
        const width = right - left; const height = bottom - top;
        left = clamp(left + point.x - start.x, 0, 100 - width); top = clamp(top + point.y - start.y, 0, 100 - height);
        right = left + width; bottom = top + height;
      } else {
        if(handle.includes('w')) left = clamp(point.x, 0, right - .1);
        if(handle.includes('e')) right = clamp(point.x, left + .1, 100);
        if(handle.includes('n')) top = clamp(point.y, 0, bottom - .1);
        if(handle.includes('s')) bottom = clamp(point.y, top + .1, 100);
      }
      return crop ? {left, top, right: 100 - right, bottom: 100 - bottom} : {...mask!, x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top};
    }, setDraft, commit);
  };
  const shape = mask?.shape === 'polygon' ? <polygon points={mask.points.map(point => `${point.x},${point.y}`).join(' ')}/>
    : mask?.shape === 'ellipse' ? <ellipse cx={mask.x} cy={mask.y} rx={mask.width / 2} ry={mask.height / 2}/>
      : <rect x={bounds.left} y={bounds.top} width={bounds.right - bounds.left} height={bounds.bottom - bounds.top}/>;
  const image = props.source ? <image href={props.source} width="100" height="100" preserveAspectRatio="xMidYMid meet"/> : <><rect width="100" height="100" fill="#263e48"/><path d="M0 85L30 20 52 58 75 35 100 80V100H0Z" fill="#567477"/></>;
  return <svg ref={svg} className="geometry-editor" viewBox="0 0 100 100" preserveAspectRatio="none" style={{aspectRatio: props.aspectRatio}} aria-label={`${props.mode === 'crop' ? 'Crop bounds' : 'Mask geometry'} editor`}>
    <defs><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill={mask?.inverted ? 'white' : 'black'}/><g fill={mask?.inverted ? 'black' : 'white'}>{shape}</g></mask></defs>
    <g opacity=".2">{image}</g><g mask={`url(#${id})`}>{image}</g>
    <g className="geometry-editor__outline" onPointerDown={event => mask?.shape !== 'polygon' && resize(event, 'move')}>{shape}</g>
    {mask?.shape === 'polygon' ? mask.points.map((point, index) => <circle key={index} className={`geometry-editor__handle ${props.selectedPoint === index ? 'geometry-editor__handle--selected' : ''}`} cx={point.x} cy={point.y} r="1.8" role="button" aria-label={`Move mask vertex ${index + 1}`} onPointerDown={event => {
      props.onSelectPoint?.(index); if(props.disabled) return;
      begin(event, point => ({...mask, points: mask.points.map((previous, candidate) => candidate === index ? point : previous)}), setDraft, commit);
    }}/>) : [['nw', bounds.left, bounds.top], ['n', (bounds.left + bounds.right) / 2, bounds.top], ['ne', bounds.right, bounds.top], ['e', bounds.right, (bounds.top + bounds.bottom) / 2], ['se', bounds.right, bounds.bottom], ['s', (bounds.left + bounds.right) / 2, bounds.bottom], ['sw', bounds.left, bounds.bottom], ['w', bounds.left, (bounds.top + bounds.bottom) / 2]].map(([handle, x, y]) => <rect key={handle} className="geometry-editor__handle" x={Number(x) - 1.5} y={Number(y) - 1.5} width="3" height="3" role="button" aria-label={`Resize ${props.mode} ${handle}`} onPointerDown={event => resize(event, String(handle))}/>)}
  </svg>;
}
