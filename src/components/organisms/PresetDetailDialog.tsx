import {useState} from 'react';
import {Download, Copy, Pencil, Trash2} from 'lucide-react';
import {resolvePresetValues, type SavedPreset} from '../../../shared/asset-presets';
import {presetApi} from '../../services/preset-api';
import {useEditor} from '../../stores/editor-store';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {NumberField} from '../atoms/Field';
import {PresetPreview} from '../molecules/PresetPreview';
import {PresetParameterFields} from '../molecules/PresetParameterFields';
export function PresetDetailDialog({preset, onClose, onEdit, onSaved}: {preset: SavedPreset; onClose: () => void; onEdit: () => void; onSaved: (preset: SavedPreset) => void}) {
  const [values, setValues] = useState(() => resolvePresetValues(preset.definition)); const [duration, setDuration] = useState(preset.definition.duration); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState(false);
  const selected = useEditor(s => s.snapshot?.project.clips.find(c => c.id === s.selectedId)); const transition = preset.definition.category === 'transition'; const editing = useEditor(s => s.busy);
  const act = async (action: () => Promise<void>) => {setBusy(true); setError(''); try {await action();} catch(error) {setError((error as Error).message);} finally {setBusy(false);}};
  return <Dialog title={preset.definition.name} onClose={onClose}><div className="settings-form"><div className="preset-meta"><span>{preset.definition.category.replace('-', ' ')}</span><span>Version {preset.version}</span><span>Saved locally</span></div><PresetPreview preset={preset} values={values} duration={duration}/><p className="settings-description">{preset.definition.description}</p>
    <PresetParameterFields definition={preset.definition} values={values} onChange={setValues}/><NumberField label="Asset duration" min={.1} max={120} step={.1} suffix="s" value={duration} onCommit={setDuration}/>
    <div className="preset-management"><Button icon={<Pencil size={14}/>} onClick={onEdit} disabled={busy}>Edit preset</Button><Button icon={<Copy size={14}/>} disabled={busy} onClick={() => void act(async () => {onSaved(await presetApi.save({...preset.definition, name: `${preset.definition.name.slice(0, 94)} copy`, duration, parameters: preset.definition.parameters.map(p => ({...p, default: values[p.key]}))} as typeof preset.definition));})}>Save variation</Button><a className="button button--secondary" href={presetApi.downloadUrl(preset.id)} download><Download size={14}/>Export preset</a><Button aria-label="Delete library preset" icon={<Trash2 size={14}/>} onClick={() => setDeleting(!deleting)} disabled={busy}/></div>
    {deleting && <div className="preset-delete"><p>Remove this preset from the library? Existing timeline clips keep their saved copy.</p><Button disabled={busy} onClick={() => void act(async () => {await presetApi.remove(preset); onClose();})}>Remove library preset</Button></div>}
    {error && <p role="alert" className="agent-inline-error">{error}</p>}<p className="field-help">{transition ? selected?.track === 'visual' ? `Applies to the start of ${selected.name}.` : 'Select an incoming video, image or background clip first.' : 'Adds an editable graphic at the playhead. These settings affect this use of the preset.'}</p>
    <div className="settings-actions"><Button disabled={busy} onClick={() => void act(async () => {const job = await presetApi.preview(preset, values, duration); useEditor.setState({renderJob: job}); onClose();})}>Render sample video</Button><Button variant="primary" disabled={busy || editing || (transition && selected?.track !== 'visual')} onClick={() => void act(async () => {if(await useEditor.getState().applyPreset(preset, values, duration)) onClose(); else setError(useEditor.getState().error || 'Unable to apply this preset.');})}>{transition ? 'Apply transition' : 'Add to timeline'}</Button></div>
  </div></Dialog>;
}
