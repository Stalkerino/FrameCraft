import {RotateCcw} from 'lucide-react';
import {isNeutralColorGrade, neutralColorGrade, type ColorGrade} from '../../../shared/color-grading';
import {NumberField} from '../atoms/Field';

export function ColorGradeFields({value, onChange, disabled = false}: {value: ColorGrade | null | undefined; onChange: (grade: ColorGrade | null) => void; disabled?: boolean}) {
  const grade = {...neutralColorGrade, ...value};
  const patch = (change: Partial<ColorGrade>) => {
    const next = {...grade, ...change};
    onChange(isNeutralColorGrade(next) ? null : next);
  };
  return <div className="color-grade-fields">
    <div className="field-row"><NumberField label="Exposure" value={grade.exposure} min={-4} max={4} step={.1} suffix="EV" disabled={disabled} onCommit={exposure => patch({exposure})}/><NumberField label="Gamma" value={grade.gamma} min={.25} max={4} step={.05} suffix="×" disabled={disabled} onCommit={gamma => patch({gamma})}/></div>
    <div className="field-row"><NumberField label="Contrast" value={grade.contrast} min={0} max={3} step={.05} suffix="×" disabled={disabled} onCommit={contrast => patch({contrast})}/><NumberField label="Saturation" value={grade.saturation} min={0} max={3} step={.05} suffix="×" disabled={disabled} onCommit={saturation => patch({saturation})}/></div>
    <div className="field-row"><NumberField label="Temperature" value={grade.temperature} min={-1} max={1} step={.05} disabled={disabled} onCommit={temperature => patch({temperature})}/><NumberField label="Tint" value={grade.tint} min={-1} max={1} step={.05} disabled={disabled} onCommit={tint => patch({tint})}/></div>
    <NumberField label="Hue" value={grade.hue} min={-180} max={180} step={1} suffix="°" disabled={disabled} onCommit={hue => patch({hue})}/>
    <p className="field-help">Positive temperature warms the image; positive tint adds magenta. Neutral contrast, saturation and gamma are 1.</p>
    <button type="button" className="color-grade-fields__reset" disabled={disabled || !value} onClick={() => onChange(null)}><RotateCcw size={12}/> Reset color grade</button>
  </div>;
}
