import {presetString, resolvePresetValues, type PresetInstance, type PresetValues, type Scalar} from './asset-presets';
import {glslNumber as n} from './gpu-color-effects';

export interface GpuTextOutline {texture: string; binding: string; function: string; bytes: number; width?: number; height?: number}
export interface GpuArtworkProgram {textures: string[]; bindings: string[]; functions: string[]; name: string}
export interface GpuVisualArtwork {graphic?: GpuArtworkProgram; transition?: GpuArtworkProgram}
export const presetFrameDenominator = (duration: number, fps: number) => Math.max(1, Math.round(duration * fps) - 1);

/** Recipe easing differs intentionally from visual-keyframe Bézier easing.
 * Preserve scalarAt's polynomial and step semantics, including exact key times.
 */
export function gpuScalar(value: Scalar, values: PresetValues, progress = 'p'): string {
  const numeric = (v: number | {param: string}) => n(typeof v === 'number' ? v : Number(values[v.param]));
  if(typeof value === 'number' || 'param' in value) return numeric(value);
  const keys = value.keyframes;
  let result = numeric(keys.at(-1)!.value);
  for(let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]; const b = keys[i + 1];
    const t = `clamp((${progress}-${n(a.at)})/${n(b.at - a.at)},0.0,1.0)`;
    const eased = value.easing === 'linear' ? t : value.easing === 'ease-in' ? `(${t}*${t})` : value.easing === 'ease-out' ? `(1.0-(1.0-${t})*(1.0-${t}))`
      : value.easing === 'step' ? `step(1.0,${t})` : `(${t}*${t}*(3.0-2.0*${t}))`;
    result = `(${progress}<=${n(b.at)}?mix(${numeric(a.value)},${numeric(b.value)},${eased}):${result})`;
  }
  return `(${progress}<=${n(keys[0].at)}?${numeric(keys[0].value)}:${result})`;
}

export const gpuArtworkPrimitives = `
vec4 fc_over(vec4 under,vec4 top){return top+under*(1.0-top.a);}
float fc_coverage(float d,float aa){return clamp(0.5-d/max(aa,0.00001),0.0,1.0);}
float fc_ellipse(vec2 p,vec2 r){float k=length(p/r);return k<0.00001?-min(r.x,r.y):k*(k-1.0)/length(p/(r*r));}
float fc_rect(vec2 p,vec2 b,float r){vec2 radius=min(vec2(r),b);vec2 q=abs(p)-b+radius;if(r>0.0&&q.x>0.0&&q.y>0.0)return fc_ellipse(q,radius);return max(abs(p).x-b.x,abs(p).y-b.y);}
vec2 fc_rotate(vec2 p,float degrees){float a=radians(degrees);return mat2(cos(a),-sin(a),sin(a),cos(a))*p;}
`;

/** Scalar uniforms and signed-distance coverage are evaluated by the GPU.
 * Text uses uploaded vector geometry, never a CPU-rasterized glyph atlas.
 */
export function gpuPresetProgram(instance: PresetInstance, name: string, texts: Map<string, GpuTextOutline> = new Map()): GpuArtworkProgram {
  const values = resolvePresetValues(instance.definition, instance.values);
  const result: GpuArtworkProgram = {name, textures: [], bindings: [], functions: []};
  const layers: string[] = [];
  instance.definition.layers.forEach((layer, index) => {
    const scalar = (field: 'x'|'y'|'width'|'height'|'opacity'|'rotation'|'scale'|'strokeWidth'|'radius'|'fontSize') => gpuScalar(layer[field], values);
    const color = (value: string | {param: string}) => {const hex = presetString(value, values); return `vec3(${[1, 3, 5].map(offset => n(parseInt(hex.slice(offset, offset + 2), 16) / 255)).join(',')})`;};
    const outline = texts.get(layer.id);
    if(layer.type === 'text' && !outline) throw new Error(`Missing GPU font geometry for ${layer.id}.`);
    if(outline) {result.textures.push(outline.texture); result.bindings.push(outline.binding); result.functions.push(outline.function);}
    const textName = `${name}_text_${index}`;
    layers.push(`{
      float s=clamp(${scalar('scale')},0.0,20.0);float opacity=clamp(${scalar('opacity')},0.0,1.0);
      vec2 b=clamp(vec2(${scalar('width')},${scalar('height')}),0.0,400.0)*size/200.0;
      float sw=clamp(${scalar('strokeWidth')},0.0,20.0)*size.y/100.0;
      if(s>0.0 && opacity>0.0 ${layer.type === 'text' ? '' : '&& b.x>0.0 && b.y>0.0'}) {
        vec2 q=fc_rotate(point-vec2(${scalar('x')},${scalar('y')})*size/100.0,${scalar('rotation')})/s;
        float aa=max(length(dFdx(q)),length(dFdy(q)));
        ${layer.type === 'text' ? `float fs=clamp(${scalar('fontSize')},0.1,100.0)*size.y/100.0;
        q.x-=${layer.align === 'left' ? '-b.x' : layer.align === 'right' ? 'b.x' : '0.0'};
        float d=${textName}(q/fs,(sw+aa)/fs)*fs;` : `float d=${layer.type === 'rect' ? `fc_rect(q,b,max(0.0,${scalar('radius')})*size.y/100.0)` : 'fc_ellipse(q,b)'};`}
        float fill=fc_coverage(d,aa);vec4 ink=vec4(${color(layer.fill)}*fill,fill);
        ${layer.stroke ? `float stroke=sw>0.0?fc_coverage(abs(d)-sw/2.0,aa):0.0;ink=fc_over(ink,vec4(${color(layer.stroke)}*stroke,stroke));` : ''}
        c=fc_over(c,ink*opacity);
      }
    }`);
  });
  result.functions.push(`vec4 ${name}(vec2 point,vec2 size,float p){vec4 c=vec4(0.0);${layers.join('\n')}return c;}`);
  return result;
}

export function gpuPresetReveal(instance: PresetInstance): string {
  const reveal = instance.definition.reveal!;
  if(reveal.type === 'fade') return 'progress';
  if(reveal.type === 'iris') return '(progress>=1.0?1.0:fc_coverage(length(canvas-size*0.5)-progress*1.5*length(size)/sqrt(2.0),max(length(dFdx(canvas)),length(dFdy(canvas)))))';
  if(reveal.type === 'wipe') {
    const value = reveal.direction === 'right' ? 'canvas.x/size.x' : reveal.direction === 'left' ? '1.0-canvas.x/size.x' : reveal.direction === 'down' ? 'canvas.y/size.y' : '1.0-canvas.y/size.y';
    return `(progress>=1.0?1.0:float(${value}<progress))`;
  }
  return `(progress>=1.0?1.0:float(progress>0.0 && canvas.x/size.x<clamp(progress*1.4-mod(floor(canvas.y/size.y*${n(reveal.steps)})*7.0,5.0)*0.08,0.0,1.0)))`;
}
