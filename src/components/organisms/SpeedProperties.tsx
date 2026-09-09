import {useEffect, useMemo, useState} from 'react';
import {Gauge, RotateCcw} from 'lucide-react';
import type {Clip, Project} from '../../../shared/project';
import {speedClipContext, speedRecipeSchema, speedTimeMap, type SpeedRecipe} from '../../../shared/speed-ramping';
import {ZodError} from 'zod';
import {useSpeedEditing} from '../../hooks/useSpeedEditing';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {SpeedRecipeEditor} from '../molecules/SpeedRecipeEditor';

export function SpeedProperties({clip, project}: {clip: Clip; project: Project}) {
  const editing = useSpeedEditing(clip.id, project.id); const editorBusy = useEditor(state => state.busy);
  const context = useMemo(() => {try {return {value: speedClipContext(project, clip), error: null};} catch(reason) {return {value: null, error: (reason as Error).message};}}, [project, clip]);
  const initial = JSON.stringify(context.value?.recipe ?? speedRecipeSchema.parse({}));
  const [recipe, setRecipe] = useState<SpeedRecipe>(() => JSON.parse(initial));
  useEffect(() => setRecipe(JSON.parse(initial)), [initial, clip.id, clip.assetId, clip.sourceStart, clip.duration]);
  const asset = project.assets.find(candidate => candidate.id === clip.assetId); const processed = Boolean(asset?.speedProcessing);
  const busy = editorBusy || editing.pending || editing.running; const sourceFrames = context.value?.sourceDurationFrames ?? clip.duration;
  const sourceFps = context.value?.fps ?? project.fps;
  const planned = useMemo(() => {
    if(!context.value) return {frames: null, error: null};
    try {return {frames: speedTimeMap(speedRecipeSchema.parse(recipe), context.value.sourceDurationSeconds, sourceFps).outputFrames, error: null};}
    catch(reason) {return {frames: null, error: reason instanceof ZodError ? reason.issues.map(issue => issue.message).join(' ') : (reason as Error).message};}
  }, [recipe, context.value, sourceFps]);
  return <div className="speed-properties">
    <p className="field-help">Retime this source span without trimming it. Other clips stay at their existing times.</p>
    <div className="speed-properties__summary"><span>Source <strong>{(sourceFrames / sourceFps).toFixed(2)} s</strong></span><span>Current <strong>{(clip.duration / project.fps).toFixed(2)} s</strong></span><span>Planned <strong>{planned.frames === null ? '—' : `${(planned.frames / project.fps).toFixed(2)} s`}</strong></span></div>
    <Field label="Speed profile"><select aria-label="Speed profile" value={recipe.points.length ? 'ramp' : 'constant'} disabled={busy || !context.value} onChange={event => setRecipe(current => ({...current, points: event.target.value === 'constant' ? [] : [{frame: 0, speed: current.speed, easing: 'smoothstep'}, {frame: sourceFrames, speed: current.speed, easing: 'linear'}]}))}><option value="constant">Constant speed</option><option value="ramp">Speed ramp</option></select></Field>
    <SpeedRecipeEditor recipe={recipe} fps={sourceFps} sourceFrames={sourceFrames} outputFps={project.fps} disabled={busy || !context.value} onChange={setRecipe}/>
    {processed && <p className="field-help">The original source and recipe are retained. Reapplying edits starts from that source, including this clip’s visible trim.</p>}
    <div className="speed-properties__actions"><Button type="button" variant="primary" icon={<Gauge size={13}/>} disabled={busy || !context.value || !!planned.error} onClick={() => void editing.apply(recipe)}>Apply speed change</Button>{processed && <Button type="button" icon={<RotateCcw size={13}/>} disabled={busy} onClick={() => void editing.reset()}>Reset to original speed</Button>}</div>
    {editing.job && <div className={`speed-properties__job speed-properties__job--${editing.job.status}`} role="status"><span>{editing.job.status === 'done' ? 'Speed change applied' : editing.job.status === 'error' ? 'Speed change failed' : editing.job.status === 'cancelled' ? 'Speed change cancelled' : editing.job.status === 'queued' ? 'Speed change queued' : `Preparing retimed media · ${Math.round(editing.job.progress * 100)}%`}</span>{editing.job.encoder && <small>{editing.job.encoder}</small>}{editing.job.warning && <p>{editing.job.warning}</p>}{editing.running && editing.job.outputDurationFrames && <small>Requested duration: {(editing.job.outputDurationFrames / project.fps).toFixed(2)} s</small>}{editing.running && <><progress aria-label="Speed processing progress" max={1} value={editing.job.progress}/><Button type="button" disabled={editing.pending} onClick={() => void editing.cancel()}>Cancel speed change</Button></>}{editing.job.error && <p>{editing.job.error}</p>}</div>}
    {(context.error || editing.error || planned.error) && <p role="alert" className="speed-properties__error">{planned.error || editing.error || context.error}</p>}
    <p className="field-help">A processed media copy is used for preview and export. Freeze holds are silent; source files remain intact.</p>
  </div>;
}
