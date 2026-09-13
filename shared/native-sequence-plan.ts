import type {NativeScenePlan, NativeSceneSpan, NativeVisualLayer} from './native-scene-plan';
import type {NativeGpuSegment} from './native-gpu-plan';
import {shiftAudioEnvelope} from './audio-envelope';

/** Walk scene groups without exposing them as media files or CPU image sources. */
export function sceneLayers(span: NativeSceneSpan): NativeVisualLayer[] {
  return span.layers.flatMap(layer => [layer, ...(layer.scene ? sceneLayers(layer.scene.span) : [])]);
}
export const sourceLayers = (span: NativeSceneSpan) => sceneLayers(span).filter(layer => !layer.scene);
export function shiftedSegment(segment: NativeGpuSegment, offset: number): NativeGpuSegment {
  return {...segment, sourceStart: segment.sourceStart + offset,
    audioEnvelope: shiftAudioEnvelope(segment.audioEnvelope, offset),
    audioGains: segment.audioGains?.map(gain => ({...gain, envelope: shiftAudioEnvelope(gain.envelope, offset)}))};
}
/** Each instance gets independent shader/artwork clocks, even when clips share IDs. */
export function namespaceScene(plan: NativeScenePlan, prefix: string): NativeScenePlan {
  const rename = (span: NativeSceneSpan): NativeSceneSpan => ({...span,
    audio: span.audio.map(segment => ({...segment, clipId: `${prefix}/${segment.clipId}`})),
    layers: span.layers.map(layer => ({...layer, clipId: `${prefix}/${layer.clipId}`, ...(layer.textClip ? {textClip: {...layer.textClip, id: `${prefix}/${layer.clipId}`}} : {}), ...(layer.scene ? {scene: {...layer.scene, span: rename(layer.scene.span)}} : {})})),
  });
  return {...plan, spans: plan.spans.map(rename)};
}
/** Slice at all descendant boundaries before composing, preserving source and animation clocks. */
export function sliceScene(span: NativeSceneSpan, frame: number, duration: number, freeze = false): NativeSceneSpan {
  const offset = frame - span.start;
  return {start: frame, duration, audio: freeze ? [] : span.audio.map(segment => ({...shiftedSegment(segment, offset), start: frame, duration})),
    layers: span.layers.map(layer => {
      const held = freeze || layer.holdFrame || layer.animation?.held;
      const advance = layer.holdFrame || layer.animation?.held ? 0 : offset;
      return {...layer, start: frame, duration, sourceStart: layer.sourceStart + advance, holdFrame: held,
        ...(layer.animation ? {animation: {...layer.animation, localFrame: layer.animation.localFrame + advance, held: !!held}} : {}),
        ...(layer.scene ? {scene: {...layer.scene, span: sliceScene(layer.scene.span, layer.scene.span.start + advance, duration, !!held)}} : {})};
    }),
  };
}
