import type {Clip} from '../../../shared/project';
import {isNeutralColorGrade} from '../../../shared/color-grading';
import {useClipColorGrading} from '../../hooks/useClipColorGrading';
import {PropertySection} from '../atoms/PropertySection';
import {ColorGradeFields} from '../molecules/ColorGradeFields';

export function ClipColorGrading({clip}: {clip: Clip}) {
  const {busy, save} = useClipColorGrading(clip.id);
  return <PropertySection title="Color grading" defaultOpen={false} summary={isNeutralColorGrade(clip.colorGrade) ? 'Neutral' : 'Adjusted'}>
    <ColorGradeFields value={clip.colorGrade} disabled={busy} onChange={grade => void save(grade)}/>
    <p className="field-help">Adjusts this clip’s image before the project-wide grade. Use Project settings → Video color grade for the whole timeline.</p>
  </PropertySection>;
}
