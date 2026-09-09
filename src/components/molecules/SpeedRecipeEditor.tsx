import {Plus, Trash2} from 'lucide-react';
import type {SpeedRecipe} from '../../../shared/speed-ramping';
import {Button, IconButton} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';

interface Props {recipe: SpeedRecipe; fps: number; sourceFrames: number; outputFps: number; disabled: boolean; onChange: (recipe: SpeedRecipe) => void}
function newPointFrame(frames: number[], maximum: number) {
  const occupied = new Set(frames); const boundaries = [0, ...frames, maximum].sort((a, b) => a - b);
  let best = -1; let gap = -1;
  for(let index = 1; index < boundaries.length; index++) {const frame = Math.floor((boundaries[index - 1] + boundaries[index]) / 2); if(!occupied.has(frame) && boundaries[index] - boundaries[index - 1] > gap) {best = frame; gap = boundaries[index] - boundaries[index - 1];}}
  if(best >= 0) return best;
  for(let frame = 0; frame <= maximum; frame++) if(!occupied.has(frame)) return frame;
  return null;
}
export function SpeedRecipeEditor({recipe, fps, sourceFrames, outputFps, disabled, onChange}: Props) {
  const pointFrame = newPointFrame(recipe.points.map(point => point.frame), sourceFrames);
  const holdFrame = newPointFrame(recipe.holds.map(hold => hold.frame), Math.max(0, sourceFrames - 1));
  return <div className="speed-recipe">
    {(!recipe.points.length || recipe.points[0].frame > 0) && <NumberField label={recipe.points.length ? 'Speed before first point' : 'Playback speed'} value={recipe.speed} min={.125} max={8} step={.125} suffix="×" disabled={disabled} onCommit={speed => onChange({...recipe, speed})}/>}
    <details className="speed-properties__group" open={recipe.points.length > 0}><summary>Speed ramp <span>{recipe.points.length} points</span></summary><p className="field-help">Point times refer to the original source span. Each easing controls the interval to the next point.</p>
      {recipe.points.map((point, index) => <div className="speed-recipe__point" key={`${index}-${point.frame}`}>
        <NumberField label={`Speed point ${index + 1} time`} value={point.frame / fps} max={sourceFrames / fps} step={1 / fps} precision={3} suffix="s" disabled={disabled} onCommit={seconds => onChange({...recipe, points: recipe.points.map((current, row) => row === index ? {...current, frame: Math.round(seconds * fps)} : current).sort((a, b) => a.frame - b.frame)})}/>
        <NumberField label={`Speed point ${index + 1} rate`} value={point.speed} min={.125} max={8} step={.125} suffix="×" disabled={disabled} onCommit={speed => onChange({...recipe, points: recipe.points.map((current, row) => row === index ? {...current, speed} : current)})}/>
        <Field label={`Speed point ${index + 1} easing`}><select aria-label={`Speed point ${index + 1} easing`} value={point.easing} disabled={disabled} onChange={event => onChange({...recipe, points: recipe.points.map((current, row) => row === index ? {...current, easing: event.target.value as typeof point.easing} : current)})}><option value="linear">Linear ramp</option><option value="smoothstep">Smooth ramp</option><option value="hold">Hold speed</option></select></Field>
        <IconButton label={`Remove speed point ${index + 1}`} disabled={disabled} onClick={() => onChange({...recipe, points: recipe.points.filter((_, row) => row !== index)})}><Trash2 size={13}/></IconButton>
      </div>)}
      <Button type="button" icon={<Plus size={13}/>} disabled={disabled || pointFrame === null} onClick={() => {if(pointFrame !== null) onChange({...recipe, points: [...recipe.points, {frame: pointFrame, speed: recipe.speed, easing: 'linear' as const}].sort((a, b) => a.frame - b.frame)});}}>Add speed point</Button>
    </details>
    <details className="speed-properties__group" open={recipe.holds.length > 0}><summary>Freeze holds <span>{recipe.holds.length}</span></summary><p className="field-help">Pause at a source frame for the chosen output duration. Holds are silent.</p>
      {recipe.holds.map((hold, index) => <div className="speed-recipe__hold" key={`${index}-${hold.frame}`}><NumberField label={`Freeze ${index + 1} source time`} value={hold.frame / fps} max={Math.max(0, sourceFrames - 1) / fps} step={1 / fps} precision={3} suffix="s" disabled={disabled} onCommit={seconds => onChange({...recipe, holds: recipe.holds.map((current, row) => row === index ? {...current, frame: Math.round(seconds * fps)} : current).sort((a, b) => a.frame - b.frame)})}/><NumberField label={`Freeze ${index + 1} duration`} value={hold.duration / outputFps} min={1 / outputFps} step={1 / outputFps} precision={3} suffix="s" disabled={disabled} onCommit={seconds => onChange({...recipe, holds: recipe.holds.map((current, row) => row === index ? {...current, duration: Math.max(1, Math.round(seconds * outputFps))} : current)})}/><IconButton label={`Remove freeze ${index + 1}`} disabled={disabled} onClick={() => onChange({...recipe, holds: recipe.holds.filter((_, row) => row !== index)})}><Trash2 size={13}/></IconButton></div>)}
      <Button type="button" icon={<Plus size={13}/>} disabled={disabled || holdFrame === null} onClick={() => {if(holdFrame !== null) onChange({...recipe, holds: [...recipe.holds, {frame: holdFrame, duration: Math.max(1, Math.round(outputFps))}].sort((a, b) => a.frame - b.frame)});}}>Add freeze hold</Button>
    </details>
    <Field label="Retimed audio"><select aria-label="Retimed audio" value={recipe.audio} disabled={disabled} onChange={event => onChange({...recipe, audio: event.target.value as SpeedRecipe['audio']})}><option value="preserve">Preserve pitch</option><option value="mute">Mute</option></select></Field>
  </div>;
}
