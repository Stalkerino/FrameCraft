import {colorGradeProgram, nativeColorTextures} from './color-grade-shader';
import type {Clip, Project} from './project';
import type {NativeVisualLayer} from './native-scene-plan';
import type {ExportSettings} from './media-settings';
import {compositionOutputTransform} from './composition-layout';
import {glslNumber as n, gpuColorOperations} from './gpu-color-effects';
import {visualEasingCurve, visualBezierIterations, visualPropertyLimits, type VisualKeyframe, type VisualProperty} from './visual-editing';
import {transitionDenominator, transitionGeometry as geometry} from './transition-timing';
import {gpuArtworkPrimitives, gpuPresetReveal, presetFrameDenominator, type GpuVisualArtwork} from './gpu-artwork';
import {gpuMaskShader} from './gpu-mask';

export interface NativeAnimation {
  clip: Pick<Clip, 'x' | 'y' | 'scale' | 'opacity' | 'crop' | 'keyframes' | 'zoom' | 'motionOffset' | 'duration' | 'transition' | 'transitionFrames' | 'presetTransition'> & Pick<Partial<Clip>, 'rotation' | 'mask'>;
  project: Pick<Project, 'width' | 'height'>;
  localFrame: number;
  held: boolean;
  opaque: boolean;
}

/** A balanced decision tree keeps lookup logarithmic even with many keys.
 * Interpolation and Bézier inversion execute in the GPU shader, using the
 * same easing parameters, clamps and trim clock as visualStateAtFrame.
 */
export function gpuKeyframeFunction(property: VisualProperty, clip: NativeAnimation['clip']) {
  const keys = clip.keyframes?.[property];
  const fallback = property === 'rotation' ? clip.rotation ?? 0 : clip[property];
  const interpolate = (key: VisualKeyframe, next?: VisualKeyframe) => {
    if(!next || key.easing === 'hold') return `return ${n(key.value)};`;
    const t = `clamp((f-${n(key.frame)})/${n(next.frame - key.frame)},0.0,1.0)`;
    const curve = visualEasingCurve(key);
    const progress = key.easing === 'linear' ? t : `fc_ease(${t},vec4(${[curve.x1, curve.y1, curve.x2, curve.y2].map(n).join(',')}))`;
    return `return clamp(mix(${n(key.value)},${n(next.value)},${progress}),${visualPropertyLimits[property].map(n).join(',')});`;
  };
  const branch = (lo: number, hi: number): string => {
    if(lo === hi) return interpolate(keys![lo], keys![lo + 1]);
    const middle = Math.ceil((lo + hi) / 2);
    return `if(f<${n(keys![middle].frame)}) {${branch(lo, middle - 1)}} else {${branch(middle, hi)}}`;
  };
  return `float fc_${property}(float f) {${!keys?.length ? `return ${n(fallback)};` : `if(f<=${n(keys[0].frame)}) return ${n(keys[0].value)}; ${branch(0, keys.length - 1)}`}}`;
}

/** One OUTPUT hook per filter and frame_mixer=none: libplacebo's hook counter
 * starts at one. Each span has its own hook; localFrame preserves the timeline
 * clock across batches/ranged exports. No CPU video pixels or per-frame files.
 */
export function gpuAnimationShader(layer: NativeVisualLayer, settings: ExportSettings, background: string, artwork: GpuVisualArtwork = {}): string {
  const motion = layer.animation!; const {clip, project} = motion;
  const transform = compositionOutputTransform(project, settings);
  const contain = Math.min(project.width / layer.asset.width!, project.height / layer.asset.height!);
  const mediaWidth = layer.asset.width! * contain; const mediaHeight = layer.asset.height! * contain;
  const crop = clip.crop ?? {left: 0, top: 0, right: 0, bottom: 0};
  const bg = [1, 3, 5].map(offset => n(parseInt(background.slice(offset, offset + 2), 16) / 255)).join(',');
  const zoom = layer.textClip ? undefined : clip.zoom;
  const programs = [artwork.graphic, artwork.transition].filter(program => !!program);
  const generated = layer.artwork || layer.textClip;
  if(generated && !artwork.graphic || clip.presetTransition && !artwork.transition) throw new Error('Native artwork must be prepared before compiling this scene.');
  const color = colorGradeProgram(layer.gradeStages);
  return [
    ...nativeColorTextures(layer.gradeStages),
    // Sample the original MAIN texture at the final OUTPUT stage. Returning
    // straight RGBA here preserves newly created alpha on opaque video too;
    // libplacebo must not reinterpret the shader's alpha during its scaler.
    ...programs.flatMap(program => program.textures),
    '//!HOOK OUTPUT', '//!BIND HOOKED', '//!BIND MAIN', ...color.textures.map(texture => `//!BIND ${texture.name}`), ...[...new Set(programs.flatMap(program => program.bindings))].map(binding => `//!BIND ${binding}`), '//!COMPONENTS 4', '//!DESC Framecraft animated visual',
    ...color.functions,
    ...(clip.mask ? [gpuMaskShader(clip.mask, project)] : []),
    ...(programs.length ? [gpuArtworkPrimitives, ...programs.flatMap(program => program.functions)] : []),
    'float fc_cubic(float t,float a,float b) {float u=1.0-t;return 3.0*u*u*t*a+3.0*u*t*t*b+t*t*t;}',
    `float fc_ease(float t,vec4 c) {if(t<=0.0||t>=1.0)return t;float lo=0.0;float hi=1.0;for(int i=0;i<${visualBezierIterations};i++){float m=(lo+hi)*0.5;if(fc_cubic(m,c.x,c.z)<t)lo=m;else hi=m;}return fc_cubic((lo+hi)*0.5,c.y,c.w);}`,
    ...(['x', 'y', 'scale', 'rotation', 'opacity'] as const).map(property => gpuKeyframeFunction(property, clip)),
    'vec2 fc_unrotate(vec2 p,float degrees){float a=radians(degrees);return mat2(cos(a),-sin(a),sin(a),cos(a))*p;}',
    // Scale-aware Lanczos2 samples the original GPU texture, avoiding an
    // intermediate source downscale that would soften animated zooms.
    'float fc_weight(float v) {v=abs(v);if(v<0.00001)return 1.0;if(v>=2.0)return 0.0;float p=3.141592653589793*v;return sin(p)*sin(p*0.5)/(p*p*0.5);}',
    'vec4 fc_sample(vec2 uv,vec2 footprint) {vec2 p=uv*MAIN_size-0.5;vec2 radius=2.0*footprint;ivec2 lo=ivec2(ceil(p-radius));ivec2 hi=ivec2(floor(p+radius));vec4 c=vec4(0.0);float total=0.0;for(int y=lo.y;y<=hi.y;y++){float wy=fc_weight((float(y)-p.y)/footprint.y);for(int x=lo.x;x<=hi.x;x++){float w=wy*fc_weight((float(x)-p.x)/footprint.x);c+=MAIN_tex((vec2(x,y)+0.5)/MAIN_size)*w;total+=w;}}return clamp(c/max(total,0.00001),0.0,1.0);}',
    'vec4 hook() {',
    `float local=${motion.held ? n(motion.localFrame) : `float(frame-1)+${n(motion.localFrame)}`};`,
    `float f=local+${n(clip.motionOffset ?? 0)};float progress=clamp(local/${n(transitionDenominator(clip))},0.0,1.0);`,
    `vec2 canvas=(HOOKED_pos*vec2(${n(settings.width)},${n(settings.height)})-vec2(${n(transform.x)},${n(transform.y)}))/vec2(${n(transform.scaleX)},${n(transform.scaleY)});`,
    `vec2 size=vec2(${n(project.width)},${n(project.height)});`,
    'if(any(lessThan(canvas,vec2(0.0)))||any(greaterThanEqual(canvas,size)))return vec4(0.0);',
    ...(clip.transition === 'slide' && !clip.presetTransition ? ['canvas.x-=(1.0-progress)*size.x;'] : []),
    'if(any(lessThan(canvas,vec2(0.0)))||any(greaterThanEqual(canvas,size)))return vec4(0.0);',
    ...(clip.transition === 'diagonal' && !clip.presetTransition ? [`if(canvas.x/size.x>progress*${n(geometry.diagonalReach)}-${n(geometry.diagonalSlope)}*canvas.y/size.y)return vec4(0.0);`] : []),
    ...(clip.transition === 'pixel' && !clip.presetTransition ? [`if(progress<1.0){float row=min(${n(geometry.pixelRows - 1)},floor(canvas.y/size.y*${n(geometry.pixelRows)}));float edge=clamp(floor((progress*${n(geometry.pixelReach)}-mod(row*${n(geometry.pixelPhase)},${n(geometry.pixelPeriod)}))*10.0)/100.0,0.0,1.0);if(canvas.x/size.x>=edge)return vec4(0.0);}`] : []),
    `float scale=fc_scale(f)${zoom ? `*mix(${n(zoom.from)},${n(zoom.to)},smoothstep(${n(zoom.start)},${n(zoom.end)},f))` : ''};`,
    ...(layer.textClip && !layer.textClip.caption && layer.textClip.animation === 'rise' ? [`canvas.y-=(1.0-clamp(f/${n(settings.fps / 2)},0.0,1.0))*25.0;`] : []),
    `vec2 origin=size*vec2(${n((zoom?.x ?? 50) / 100)},${n((zoom?.y ?? 50) / 100)});`,
    'vec2 point=fc_unrotate(canvas-size*(vec2(fc_x(f),fc_y(f))/100.0-0.5)-origin,fc_rotation(f))/scale+origin;',
    `vec2 uv=(point-(size-vec2(${n(mediaWidth)},${n(mediaHeight)}))*0.5)/vec2(${n(mediaWidth)},${n(mediaHeight)});`,
    ...(!artwork.graphic ? ['vec2 du=dFdx(uv)*MAIN_size;vec2 dv=dFdy(uv)*MAIN_size;'] : []),
    'vec4 c=vec4(0.0);',
    ...(clip.mask && !layer.textClip ? ['float maskAlpha=fc_mask(point,dFdx(point),dFdy(point));'] : []),
    `if(${generated ? 'true' : 'all(greaterThanEqual(uv,vec2(0.0)))&&all(lessThan(uv,vec2(1.0)))'}${!generated || clip.crop && !layer.textClip ? `&&all(greaterThanEqual(point,size*vec2(${n(crop.left / 100)},${n(crop.top / 100)})))&&all(lessThan(point,size*vec2(${n(1 - crop.right / 100)},${n(1 - crop.bottom / 100)})))` : ''}) {`,
    artwork.graphic ? `c=${artwork.graphic.name}(point,size,${layer.textClip ? 'f' : `clamp(f/${n(presetFrameDenominator(layer.artwork!.duration, settings.fps))},0.0,1.0)`});` : 'c=fc_sample(uv,max(vec2(1.0),sqrt(du*du+dv*dv)));',
    'c.rgb=c.a>0.0?c.rgb/c.a:vec3(0.0);', ...gpuColorOperations(layer.gradeStages), 'c.rgb*=c.a;', '}',
    ...(clip.mask && !layer.textClip ? ['c*=maskAlpha;'] : []),
    ...(motion.opaque ? [`c.rgb+=vec3(${bg})*(1.0-c.a);c.a=1.0;`] : []),
    ...(clip.presetTransition ? [`c*=${gpuPresetReveal(clip.presetTransition)};`, `if(progress<1.0)c=fc_over(c,${artwork.transition!.name}(canvas,size,progress));`] : []),
    'c.rgb=c.a>0.0?c.rgb/c.a:vec3(0.0);',
    `c.a*=fc_opacity(f)${clip.transition === 'fade' && !clip.presetTransition ? '*progress' : ''};return c;`, '}',
  ].join('\n');
}
