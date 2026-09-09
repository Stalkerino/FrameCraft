import {frameRatePresets, resolutionPresets} from '../../../shared/media-settings';
import {Field} from '../atoms/Field';
export function ResolutionFields({value, onChange}: {value: {width: number; height: number; fps: number}; onChange: (patch: Partial<typeof value>) => void}) {
  const preset = resolutionPresets.findIndex(p => p.width === value.width && p.height === value.height);
  return <>
    <Field label="Resolution preset"><select aria-label="Resolution preset" value={preset} onChange={event => {const selected = resolutionPresets[Number(event.target.value)]; if(selected) onChange({width: selected.width, height: selected.height});}}><option value={-1}>Custom resolution</option>{resolutionPresets.map((p, i) => <option key={i} value={i}>{p.label}</option>)}</select></Field>
    <div className="settings-grid"><Field label="Width (px)"><input aria-label="Width (px)" type="number" min={64} max={8192} step={2} value={value.width} onChange={event => onChange({width: Number(event.target.value)})}/></Field><Field label="Height (px)"><input aria-label="Height (px)" type="number" min={64} max={8192} step={2} value={value.height} onChange={event => onChange({height: Number(event.target.value)})}/></Field></div>
    <div className="settings-grid"><Field label="Frame rate preset"><select aria-label="Frame rate preset" value={frameRatePresets.includes(value.fps) ? value.fps : ''} onChange={event => {if(event.target.value) onChange({fps: Number(event.target.value)});}}><option value="">Custom frame rate</option>{frameRatePresets.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></Field><Field label="Frame rate (fps)"><input aria-label="Frame rate (fps)" type="number" min={1} max={120} step="any" value={value.fps} onChange={event => onChange({fps: Number(event.target.value)})}/></Field></div>
  </>;
}
