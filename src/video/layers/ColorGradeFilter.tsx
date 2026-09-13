import type {ColorLut} from '../../../shared/color-lut';
import {Fragment, useId, useMemo, type ReactNode} from 'react';
import {colorGradeStages, type ColorGrade} from '../../../shared/color-grading';

/** Grade source media only; titles, transitions and generated artwork stay outside. */
export function ColorGradeFilter({clip, project, children, luts}: {luts?: ColorLut[]; clip?: ColorGrade | null; project?: ColorGrade | null; children: ReactNode}) {
  const id = `framecraft-grade-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const stages = useMemo(() => colorGradeStages(clip, project, luts), [clip, project, luts]);
  if(stages.some(stage => stage.lut)) throw new Error('This grouped LUT requires the native GPU monitor/export.');
  return <>{stages.length > 0 && <svg width="0" height="0" aria-hidden="true" style={{position: 'absolute', pointerEvents: 'none'}}><defs>
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      {stages.map((stage, index) => <Fragment key={index}>
        <feColorMatrix colorInterpolationFilters={stage.space ? 'linearRGB' : 'sRGB'} in={index ? `grade-${index - 1}` : 'SourceGraphic'} type="matrix" values={stage.matrix.join(' ')} result={`matrix-${index}`}/>
        <feComponentTransfer colorInterpolationFilters={stage.space ? 'linearRGB' : 'sRGB'} in={`matrix-${index}`} result={`grade-${index}`}>
          <feFuncR type="gamma" amplitude="1" exponent={stage.exponent} offset="0"/>
          <feFuncG type="gamma" amplitude="1" exponent={stage.exponent} offset="0"/>
          <feFuncB type="gamma" amplitude="1" exponent={stage.exponent} offset="0"/>
          <feFuncA type="identity"/>
        </feComponentTransfer>
      </Fragment>)}
    </filter>
  </defs></svg>}<div data-color-grade={stages.length ? 'active' : undefined} style={{position: 'absolute', inset: 0, filter: stages.length ? `url(#${id})` : undefined}}>{children}</div></>;
}
