import type {ColorGradeStage} from './color-grading';
import {lutValues} from './color-lut';
export const shaderNumber = (value: number) => {if(!Number.isFinite(value)) throw new Error('Non-finite color parameter.'); const s = String(value); return /[.e]/i.test(s) ? s : `${s}.0`;};
const n = shaderNumber;
export function colorGradeProgram(stages: ColorGradeStage[]) {
  const textures = stages.flatMap((stage, index) => stage.lut ? [{name: `fc_lut${index}`, lut: stage.lut}] : []);
  const functions = [
    'vec3 fc_linear(vec3 v){return mix(v/12.92,pow((v+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),v));}',
    'vec3 fc_encoded(vec3 v){return mix(v*12.92,1.055*pow(max(v,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),v));}',
    ...textures.map(({name, lut}) => `vec3 ${name}_node(vec3 p){return ${name}_tex(vec2((p.r+p.b*${n(lut.size)}+0.5)/${n(lut.size*lut.size)},(p.g+0.5)/${n(lut.size)})).rgb;}
vec3 ${name}_apply(vec3 v){vec3 p=clamp((v-vec3(${lut.domainMin.map(n)}))/vec3(${lut.domainMax.map((v,i) => n(v-lut.domainMin[i]))}),0.0,1.0)*${n(lut.size-1)};vec3 a=floor(p);vec3 b=min(a+1.0,vec3(${n(lut.size-1)}));vec3 f=fract(p);
return mix(mix(mix(${name}_node(vec3(a.r,a.g,a.b)),${name}_node(vec3(b.r,a.g,a.b)),f.r),mix(${name}_node(vec3(a.r,b.g,a.b)),${name}_node(vec3(b.r,b.g,a.b)),f.r),f.g),mix(mix(${name}_node(vec3(a.r,a.g,b.b)),${name}_node(vec3(b.r,a.g,b.b)),f.r),mix(${name}_node(vec3(a.r,b.g,b.b)),${name}_node(vec3(b.r,b.g,b.b)),f.r),f.g),f.b);}`),
  ];
  const operations = stages.flatMap(({matrix: m, exponent, space, lut, strength = 1}, index) => {
    const channels = [0,5,10].map(i => `dot(vec3(${m.slice(i,i+3).map(n)}),c.rgb)+${n(m[i+4])}`);
    return [...(space ? ['c.rgb=fc_linear(c.rgb);'] : []), `c.rgb=pow(clamp(vec3(${channels.join(',')}),0.0,1.0),vec3(${n(exponent)}));`,
      ...(space ? ['c.rgb=fc_encoded(c.rgb);'] : []), ...(lut ? [`c.rgb=clamp(mix(c.rgb,fc_lut${index}_apply(c.rgb),${n(strength)}),0.0,1.0);`] : [])];
  });
  return {textures, functions, operations};
}
/** LUT texels are metadata uploaded once; video pixels never leave the GPU. */
export function colorLutRgba(lut: ColorGradeStage['lut'] & {}) {
  const rgb = lutValues(lut); const rgba = new Float32Array(lut.size ** 3 * 4);
  // Atlas x = red + blue*size; y = green.
  for(let b=0;b<lut.size;b++) for(let g=0;g<lut.size;g++) for(let r=0;r<lut.size;r++) {
    const source=(b*lut.size*lut.size+g*lut.size+r)*3; const dest=(g*lut.size*lut.size+b*lut.size+r)*4;
    rgba.set(rgb.subarray(source,source+3),dest); rgba[dest+3]=1;
  }
  return rgba;
}
export function nativeColorTextures(stages: ColorGradeStage[]) {
  const program = colorGradeProgram(stages);
  return program.textures.map(({name,lut}) => {
    const values=colorLutRgba(lut); const bytes=new Uint8Array(values.length*4); const data=new DataView(bytes.buffer); values.forEach((value,i)=>data.setFloat32(i*4,value,true));
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
    return `//!TEXTURE ${name}\n//!SIZE ${lut.size*lut.size} ${lut.size}\n//!FORMAT rgba32f\n//!FILTER NEAREST\n//!BORDER CLAMP\n${hex}`;
  });
}
