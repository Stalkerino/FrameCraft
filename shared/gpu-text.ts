import type {Clip} from './project';
import type {GpuArtworkProgram, GpuTextOutline} from './gpu-artwork';
import {glslNumber as n} from './gpu-color-effects';

export interface CaptionBox {x: number; y: number; width: number; height: number}
const color = (hex: string) => `vec3(${[1, 3, 5].map(offset => n(parseInt(hex.slice(offset, offset + 2), 16) / 255)).join(',')})`;

/** Glyph coverage, timed colors, shadows and box cropping execute on GPU.
 * The selected typewriter state's geometry includes its own measured box.
 */
export function gpuTitleProgram(clip: Clip, fps: number, outline: GpuTextOutline, states = [clip.text.length], boxes: CaptionBox[] = []): GpuArtworkProgram {
  const caption = clip.caption;
  const branch = (lo: number, hi: number): string => {
    if(lo === hi) return `return ${lo};`;
    const middle = Math.ceil((lo + hi) / 2);
    return `if(count<${n(states[middle])}){${branch(lo, middle - 1)}}else{${branch(middle, hi)}}`;
  };
  const crop = clip.crop;
  const boxCode = crop || clip.mask ? `vec2 box=fc_title_outline_box(state)*fs;
    vec2 corner=${caption ? '-box*0.5' : `vec2(-box.x*${n(clip.align === 'center' ? .5 : clip.align === 'right' ? 1 : 0)},0.0)`};
    if(any(lessThanEqual(box,vec2(0.0))))return vec4(0.0);` : '';
  const cropCode = crop ? `if(any(lessThan(q,corner+box*vec2(${n(crop.left / 100)},${n(crop.top / 100)})))||any(greaterThanEqual(q,corner+box*vec2(${n(1 - crop.right / 100)},${n(1 - crop.bottom / 100)}))))return vec4(0.0);` : '';
  return {name: 'fc_graphic', textures: [outline.texture], bindings: [outline.binding], functions: [outline.function,
    `int fc_title_state(float f){float count=floor(f/${n(fps)}*45.0);${branch(0, states.length - 1)}}`,
    `float fc_title_shadow(vec2 q,float fs,int state,float blur,vec2 offset){
      float shadow=0.0;float total=0.0;
      for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
        float w=exp(-float(x*x+y*y)*0.5);vec2 samplePoint=q-offset+vec2(x,y)*blur;
        float sd=fc_title_outline_sample(samplePoint/fs,blur/fs,state,-2.0).x*fs;
        shadow+=fc_coverage(sd,blur)*w;total+=w;
      }return shadow/total;
    }`,
    `vec4 fc_graphic(vec2 point,vec2 size,float f){
      vec2 q=point-size*0.5;float progress=clamp(f/${n(fps / 2)},0.0,1.0);
      float fs=${n(clip.fontSize)};float aa=max(length(dFdx(q)),length(dFdy(q)));
      int state=fc_title_state(f);${boxCode}
      ${clip.mask ? 'vec2 maskPoint=(q-corner)/box*size;float maskAlpha=fc_mask(maskPoint,dFdx(maskPoint),dFdy(maskPoint));' : ''}
      ${cropCode}
      vec2 d=fc_title_outline_sample(q/fs,aa/fs,state,${caption ? `f+${n(clip.sourceStart - (clip.motionOffset ?? 0))}` : '-2.0'})*fs;
      float alpha=fc_coverage(d.x,aa);
      vec3 ink=${color(clip.color)};
      ${caption?.style === 'highlight' ? `ink=mix(ink,${color(caption.highlightColor)},clamp(fc_coverage(d.y,aa)/max(alpha,0.00001),0.0,1.0));` : ''}
      vec4 c=vec4(0.0);
      ${boxes.map(box => `{float a=fc_coverage(fc_rect(q-vec2(${n(box.x + box.width / 2)},${n(box.y + box.height / 2)}),vec2(${n(box.width / 2)},${n(box.height / 2)}),12.0),aa)*${n(235 / 255)};c=fc_over(c,vec4(${color('#080c0e')}*a,a));}`).join('\n')}
      float shadow=fc_title_shadow(q,fs,state,12.0,vec2(0.0,${caption ? '0.0' : '2.0'}))*${caption ? n(136 / 255) : '0.25'};
      ${caption ? 'shadow=1.0-(1.0-shadow)*(1.0-fc_title_shadow(q,fs,state,4.0,vec2(0.0,2.0)));' : ''}
      c=fc_over(c,vec4(0.0,0.0,0.0,shadow));
      return fc_over(c,vec4(ink*alpha,alpha))${!caption && clip.animation === 'rise' ? '*progress' : ''}${clip.mask ? '*maskAlpha' : ''};
    }`]};
}
