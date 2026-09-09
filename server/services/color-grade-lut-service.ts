import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {colorGradeMatrixCube, colorGradeStages, type ColorGrade} from '../../shared/color-grading';

/** Files belong to one render workspace and are reused across identically graded cuts. */
export class ColorGradeLutService {
  private files = new Map<string, Promise<string>>();
  constructor(private directory: string) {}
  async ensure(clip?: ColorGrade | null, project?: ColorGrade | null, opacity = 1, background = '#080c0e'): Promise<string | undefined> {
    const stages = colorGradeStages(clip, project);
    if(!stages.length && opacity === 1) return undefined;
    const filters = ['format=gbrp'];
    const identity = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    for(const stage of stages) {
      if(stage.matrix.some((value, index) => Math.abs(value - identity[index]) > 1e-12)) {
        const key = JSON.stringify(stage.matrix);
        let pending = this.files.get(key);
        if(!pending) {
          const file = path.join(this.directory, `grade-${createHash('sha256').update(key).digest('hex').slice(0, 20)}.cube`);
          pending = writeFile(file, colorGradeMatrixCube(stage.matrix)).then(() => file);
          this.files.set(key, pending);
        }
        filters.push(colorGradeLutFilter(await pending));
      }
      if(stage.exponent !== 1) filters.push(`lutrgb=${['r', 'g', 'b'].map(channel => `${channel}='pow(val/maxval,${stage.exponent})*maxval'`).join(':')}`);
    }
    if(opacity !== 1) filters.push(`lutrgb=${['r', 'g', 'b'].map((channel, index) => `${channel}='val*${opacity}+maxval*${parseInt(background.slice(1 + index * 2, 3 + index * 2), 16) / 255}*${1 - opacity}'`).join(':')}`);
    filters.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv444p');
    return filters.join(',');
  }
}

/** Escape the option parser and then the filtergraph parser; shell quoting is not used. */
export function colorGradeLutFilter(file: string): string {
  const value = file.replace(/\\/g, '/').replace(/([\\':])/g, '\\$1').replace(/([\\'\[\],;])/g, '\\$1');
  return `lut3d=file=${value}:interp=tetrahedral`;
}
