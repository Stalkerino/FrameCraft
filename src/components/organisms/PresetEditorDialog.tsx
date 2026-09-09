import {useState} from 'react';
import {presetDefinitionSchema, resolvePresetValues, type PresetDefinition, type SavedPreset} from '../../../shared/asset-presets';
import {presetStarters} from '../../../shared/preset-starters';
import {presetApi} from '../../services/preset-api';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';
import {PresetParameterFields} from '../molecules/PresetParameterFields';
import {PresetPreview} from '../molecules/PresetPreview';
export function PresetEditorDialog({initial, existing, onClose, onSaved}: {initial: PresetDefinition; existing?: SavedPreset; onClose: () => void; onSaved: (preset: SavedPreset) => void}) {
  const [definition, setDefinition] = useState(initial); const [recipe, setRecipe] = useState(JSON.stringify(initial, null, 2)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const change = (next: PresetDefinition) => {setDefinition(next); setRecipe(JSON.stringify(next, null, 2)); setError('');};
  const save = async () => {setBusy(true); setError(''); try {const parsed = presetDefinitionSchema.parse(definition); onSaved(await presetApi.save(parsed, existing));} catch(error) {setError((error as Error).message);} finally {setBusy(false);}};
  const preset: SavedPreset = {id: existing?.id ?? 'draft', version: existing?.version ?? 1, definition, createdAt: '', updatedAt: ''};
  return <Dialog title={existing ? 'Edit asset preset' : 'Create asset preset'} onClose={onClose}><div className="settings-form preset-editor">
    {!existing && <Field label="Starting template"><select aria-label="Starting template" onChange={event => {const starter = presetStarters.find(p => p.id === event.target.value); if(starter) change({...structuredClone(starter.definition), name: `My ${starter.definition.name}`});}} defaultValue=""><option value="" disabled>Choose a starting point</option>{presetStarters.map(p => <option key={p.id} value={p.id}>{p.definition.name}</option>)}</select></Field>}
    <PresetPreview preset={preset} values={{}} duration={definition.duration}/>
    <Field label="Preset name"><input aria-label="Preset name" maxLength={100} value={definition.name} onChange={event => change({...definition, name: event.target.value})}/></Field>
    <Field label="Description"><textarea aria-label="Preset description" maxLength={500} rows={2} value={definition.description} onChange={event => change({...definition, description: event.target.value})}/></Field>
    <NumberField label="Default duration" min={.1} max={120} step={.1} suffix="s" value={definition.duration} onCommit={duration => change({...definition, duration})}/>
    <PresetParameterFields definition={definition} values={resolvePresetValues(definition)} onChange={values => change({...definition, parameters: definition.parameters.map(p => ({...p, default: values[p.key]}))} as PresetDefinition)}/>
    <details className="preset-recipe"><summary>Advanced recipe · layers and animation</summary><p>Coordinates are percentages; keyframe times run from 0 to 1. Apply recipe changes to update the preview before saving.</p><textarea aria-label="Asset recipe JSON" spellCheck={false} value={recipe} onChange={event => setRecipe(event.target.value)}/><Button onClick={() => {try {change(presetDefinitionSchema.parse(JSON.parse(recipe)));} catch(error) {setError((error as Error).message);}}}>Update recipe preview</Button></details>
    {existing && <p className="field-help">Saves version {existing.version + 1}. Existing timeline clips keep their current appearance.</p>}
    {error && <p role="alert" className="agent-inline-error">{error}</p>}<div className="settings-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || recipe !== JSON.stringify(definition, null, 2)} onClick={() => void save()}>Save asset preset</Button></div>
  </div></Dialog>;
}
