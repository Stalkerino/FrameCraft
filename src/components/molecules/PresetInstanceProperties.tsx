import {useState} from 'react';
import type {Clip} from '../../../shared/project';
import type {PresetDefinition, PresetInstance} from '../../../shared/asset-presets';
import {presetApi} from '../../services/preset-api';
import {usePresets} from '../../stores/preset-store';
import {PresetParameterFields} from './PresetParameterFields';
import {NumberField} from '../atoms/Field';
import {Button} from '../atoms/Button';
import {PropertySection} from '../atoms/PropertySection';
function InstanceFields({instance, transition, onChange}: {instance: PresetInstance; transition: boolean; onChange: (instance: PresetInstance) => void}) {
  const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false);
  return <PropertySection title={transition ? 'Saved transition controls' : 'Preset controls'}><div className="preset-instance"><p className="field-help">{instance.definition.name} · v{instance.version}</p><PresetParameterFields definition={instance.definition} values={instance.values} onChange={values => onChange({...instance, values})}/>{!transition && <NumberField label="Animation length" min={.1} max={120} step={.1} suffix="s" value={instance.duration} onCommit={duration => onChange({...instance, duration})}/>}<Button disabled={saving} onClick={() => {setSaving(true); void presetApi.save({...instance.definition, name: `${instance.definition.name.slice(0, 90)} variation`, duration: instance.duration, parameters: instance.definition.parameters.map(p => ({...p, default: instance.values[p.key] ?? p.default}))} as PresetDefinition).then(() => {setMessage('Variation saved to Presets.'); void usePresets.getState().refresh();}).catch(error => setMessage(error.message)).finally(() => setSaving(false));}}>Save as library variation</Button>{message && <p className="field-help" role="status">{message}</p>}</div></PropertySection>;
}
export function PresetInstanceProperties({clip, patch}: {clip: Clip; patch: (value: Partial<Clip>, label?: string) => void}) {
  return <>{clip.graphic && <InstanceFields instance={clip.graphic} transition={false} onChange={graphic => patch({graphic}, 'Customized graphic asset')}/>} {clip.presetTransition && <InstanceFields instance={clip.presetTransition} transition onChange={presetTransition => patch({presetTransition}, 'Customized saved transition')}/>}</>;
}
