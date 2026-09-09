import {Plus, Trash2} from 'lucide-react';
import {useState} from 'react';
import {ZodError} from 'zod';
import type {Clip, Project} from '../../../shared/project';
import {cropSchema, maskSchema, type Crop, type Mask} from '../../../shared/visual-editing';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';
import {PropertySection} from '../atoms/PropertySection';
import {GeometryEditor} from '../molecules/GeometryEditor';

export function CropMaskProperties({clip, project}: {clip: Clip; project: Project}) {
  const busy = useEditor(state => state.busy); const [error, setError] = useState(''); const [pointIndex, setPointIndex] = useState(0);
  const asset = project.assets.find(asset => asset.id === clip.assetId);
  const source = asset?.thumbnail ?? (asset?.kind === 'image' ? asset.src : undefined);
  const crop = clip.crop ?? {left: 0, right: 0, top: 0, bottom: 0}; const mask = clip.mask;
  const selectedPoint = Math.max(0, Math.min(pointIndex, (mask?.points.length ?? 1) - 1));
  const point = mask?.points[selectedPoint];
  const message = (error: unknown) => error instanceof ZodError ? error.issues[0].message : (error as Error).message;
  const saveCrop = (value: Crop | null) => {try {setError(''); void useEditor.getState().updateClip(clip.id, {crop: value ? cropSchema.parse(value) : null}, 'Changed clip crop');} catch(error) {setError(message(error));}};
  const saveMask = (value: Mask | null) => {try {setError(''); void useEditor.getState().updateClip(clip.id, {mask: value ? maskSchema.parse(value) : null}, 'Changed clip mask');} catch(error) {setError(message(error));}};
  const changeShape = (shape: string) => {
    if(shape === 'none') {saveMask(null); return;}
    const value = {...mask, shape, points: mask?.points.length ? mask.points : [{x: 10, y: 10}, {x: 90, y: 10}, {x: 90, y: 90}, {x: 10, y: 90}]};
    saveMask(maskSchema.parse(value)); setPointIndex(0);
  };
  return <>
    <PropertySection title="Crop" defaultOpen={false} summary={clip.crop ? 'Adjusted' : 'Full frame'}>
      <GeometryEditor mode="crop" value={crop} source={source} aspectRatio={project.width / project.height} disabled={busy} revision={clip} onCommit={saveCrop}/>
      <div className="field-row"><NumberField label="Crop left" value={crop.left} max={99.9 - crop.right} step={.5} suffix="%" disabled={busy} onCommit={left => saveCrop({...crop, left})}/><NumberField label="Crop right" value={crop.right} max={99.9 - crop.left} step={.5} suffix="%" disabled={busy} onCommit={right => saveCrop({...crop, right})}/></div>
      <div className="field-row"><NumberField label="Crop top" value={crop.top} max={99.9 - crop.bottom} step={.5} suffix="%" disabled={busy} onCommit={top => saveCrop({...crop, top})}/><NumberField label="Crop bottom" value={crop.bottom} max={99.9 - crop.top} step={.5} suffix="%" disabled={busy} onCommit={bottom => saveCrop({...crop, bottom})}/></div>
      <p className="field-help">Drag the edges or corners to crop; drag inside to move the retained area. Cropping hides pixels without stretching the source.</p>
      <Button type="button" disabled={busy || !clip.crop} onClick={() => saveCrop(null)}>Reset crop</Button>
    </PropertySection>
    <PropertySection title="Mask" defaultOpen={false} summary={mask ? `${mask.shape}${mask.inverted ? ' · inverted' : ''}` : 'None'}>
      <Field label="Mask shape"><select aria-label="Mask shape" disabled={busy} value={mask?.shape ?? 'none'} onChange={event => changeShape(event.target.value)}><option value="none">No mask</option><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="polygon">Polygon</option></select></Field>
      {mask && <>
        <GeometryEditor mode="mask" value={mask} source={source} aspectRatio={project.width / project.height} disabled={busy} revision={clip} onCommit={saveMask} selectedPoint={selectedPoint} onSelectPoint={setPointIndex}/>
        {mask.shape === 'polygon' ? <>
          <Field label="Polygon vertex"><select aria-label="Polygon vertex" value={selectedPoint} onChange={event => setPointIndex(Number(event.target.value))}>{mask.points.map((_, index) => <option value={index} key={index}>Vertex {index + 1}</option>)}</select></Field>
          {point && <div className="field-row"><NumberField label="Vertex X" value={point.x} max={100} step={.5} suffix="%" disabled={busy} onCommit={x => saveMask({...mask, points: mask.points.map((value, index) => index === selectedPoint ? {...value, x} : value)})}/><NumberField label="Vertex Y" value={point.y} max={100} step={.5} suffix="%" disabled={busy} onCommit={y => saveMask({...mask, points: mask.points.map((value, index) => index === selectedPoint ? {...value, y} : value)})}/></div>}
          <div className="geometry-actions"><Button type="button" icon={<Plus size={12}/>} disabled={busy} onClick={() => {if(!point) return; const next = mask.points[(selectedPoint + 1) % mask.points.length]; const points = [...mask.points]; points.splice(selectedPoint + 1, 0, {x: (point.x + next.x) / 2, y: (point.y + next.y) / 2}); saveMask({...mask, points}); setPointIndex(selectedPoint + 1);}}>Add vertex</Button><Button type="button" icon={<Trash2 size={12}/>} disabled={busy || mask.points.length <= 3} onClick={() => {saveMask({...mask, points: mask.points.filter((_, index) => index !== selectedPoint)}); setPointIndex(Math.max(0, selectedPoint - 1));}}>Remove vertex</Button></div>
        </> : <>
          <div className="field-row"><NumberField label="Mask center X" value={mask.x} max={100} step={.5} suffix="%" disabled={busy} onCommit={x => saveMask({...mask, x})}/><NumberField label="Mask center Y" value={mask.y} max={100} step={.5} suffix="%" disabled={busy} onCommit={y => saveMask({...mask, y})}/></div>
          <div className="field-row"><NumberField label="Mask width" value={mask.width} min={.1} max={100} step={.5} suffix="%" disabled={busy} onCommit={width => saveMask({...mask, width})}/><NumberField label="Mask height" value={mask.height} min={.1} max={100} step={.5} suffix="%" disabled={busy} onCommit={height => saveMask({...mask, height})}/></div>
        </>}
        <div className="field-row"><NumberField label="Mask feather" value={mask.feather} max={500} suffix="px" disabled={busy} onCommit={feather => saveMask({...mask, feather})}/><label className="geometry-toggle"><input type="checkbox" checked={mask.inverted} disabled={busy} onChange={event => saveMask({...mask, inverted: event.target.checked})}/> Invert mask</label></div>
        <p className="field-help">Drag bounds or polygon vertices in the guide. Percentages use the element’s drawing box; video/image use the canvas-sized contain box. The program monitor shows feathering and the final composition.</p>
        <Button type="button" disabled={busy} onClick={() => saveMask(null)}>Remove mask</Button>
      </>}
      {error && <p className="geometry-error" role="alert">{error}</p>}
    </PropertySection>
  </>;
}
