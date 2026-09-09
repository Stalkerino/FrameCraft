import {useEffect, useState, type ReactNode} from 'react';
export function Field({label, children}: {label: string; children: ReactNode}) {return <label className="field"><span>{label}</span>{children}</label>;}
export function NumberField({label, value, onCommit, min = 0, max = 999999, step = 1, suffix, disabled = false, precision = 2}: {label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean; precision?: number}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Number(value.toFixed(precision)))), [value, precision]);
  const commit = () => {if(disabled) return; const parsed = Number(draft); if(!Number.isFinite(parsed) || draft.trim() === '') {setDraft(String(value)); return;} const next = Math.min(max, Math.max(min, parsed)); if(next !== value) onCommit(next); setDraft(String(next));};
  return <Field label={label}><div className="number-field"><input aria-label={label} type="number" disabled={disabled} min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {if(e.key === 'Enter') e.currentTarget.blur();}}/>{suffix && <span>{suffix}</span>}</div></Field>;
}
