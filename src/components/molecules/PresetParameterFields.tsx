import {useEffect, useState} from 'react';
import type {PresetDefinition, PresetValues} from '../../../shared/asset-presets';
import {Field, NumberField} from '../atoms/Field';
function PresetTextField({label, value, onCommit}: {label: string; value: string; onCommit: (value: string) => void}) {
  const [draft, setDraft] = useState(value); useEffect(() => setDraft(value), [value]);
  return <Field label={label}><textarea aria-label={label} value={draft} maxLength={1000} rows={2} onChange={event => setDraft(event.target.value)} onBlur={() => {if(value !== draft) onCommit(draft);}}/></Field>;
}
export function PresetParameterFields({definition, values, onChange}: {definition: PresetDefinition; values: PresetValues; onChange: (values: PresetValues) => void}) {
  return <div className="preset-parameters">{definition.parameters.map(parameter => {
    const value = values[parameter.key] ?? parameter.default; const change = (next: string | number) => onChange({...values, [parameter.key]: next});
    return parameter.type === 'number' ? <NumberField key={parameter.key} label={parameter.label} value={Number(value)} min={parameter.min} max={parameter.max} step={parameter.step} onCommit={change}/> : parameter.type === 'color' ? <Field key={parameter.key} label={parameter.label}><div className="color-field"><input type="color" aria-label={parameter.label} value={String(value)} onChange={event => change(event.target.value)}/><span>{String(value).toUpperCase()}</span></div></Field> : <PresetTextField key={parameter.key} label={parameter.label} value={String(value)} onCommit={change}/>;
  })}</div>;
}
