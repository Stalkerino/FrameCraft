import {colorGradeProgram, nativeColorTextures} from './color-grade-shader';
import type {ColorGradeStage} from './color-grading';

export const glslNumber = (value: number) => {
  if(!Number.isFinite(value)) throw new Error('GPU effect parameters must be finite.');
  const text = String(value); return /[.e]/i.test(text) ? text : text + '.0';
};
const number = glslNumber;

export function gpuColorOperations(stages: ColorGradeStage[]): string[] {
  return colorGradeProgram(stages).operations;
}

/** Same ordered sRGB matrix/clamp/gamma operations as ColorGradeFilter.
 * GLSL executes per pixel; building this small program is CPU control work.
 */
export function gpuColorShader(stages: ColorGradeStage[], opacity = 1): string {
  const program = colorGradeProgram(stages); const operations = program.operations;
  // MAIN uses premultiplied RGB. Grade independent channels, then restore
  // premultiplication; OUTPUT follows conversion to our straight-alpha RGBA.
  return [
    ...nativeColorTextures(stages),
    ...(operations.length ? ['//!HOOK MAIN', '//!BIND HOOKED', '//!COMPONENTS 4', '//!DESC Framecraft grading', ...program.textures.map(texture => `//!BIND ${texture.name}`), ...program.functions,
      'vec4 hook() {', 'vec4 c = HOOKED_tex(HOOKED_pos);', 'c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);',
      ...operations, 'c.rgb *= c.a;', 'return c;', '}'] : []),
    '//!HOOK OUTPUT', '//!BIND HOOKED', '//!COMPONENTS 4', '//!DESC Framecraft opacity',
    'vec4 hook() {', 'vec4 c = HOOKED_tex(HOOKED_pos);', `c.a *= ${number(opacity)};`, 'return c;', '}',
  ].join('\n');
}
