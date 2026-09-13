import type {NativeSceneSpan, NativeVisualLayer} from './native-scene-plan';

const appearance = (layer: NativeVisualLayer) => JSON.stringify([layer.asset.id, layer.trackId, layer.placement, layer.opacity, layer.gradeStages, layer.artwork, layer.textClip, layer.animation && {...layer.animation, localFrame: 0}]);

/** Audio-only boundaries and contiguous identical cuts need not restart video.
 * Preserve the original audio spans separately; do not mutate the edit plan.
 */
export function continuousVisualSpans(spans: NativeSceneSpan[]): NativeSceneSpan[] {
  const result: NativeSceneSpan[] = [];
  for(const span of spans) {
    const previous = result.at(-1);
    const continues = !span.layers.some(layer => layer.scene) && previous && previous.start + previous.duration === span.start && previous.layers.length === span.layers.length
      && span.layers.every((layer, index) => appearance(layer) === appearance(previous.layers[index])
        && (!layer.animation || layer.animation.localFrame === previous.layers[index].animation!.localFrame + (layer.animation.held ? 0 : previous.duration))
        && (layer.asset.kind === 'image' || layer.sourceStart === previous.layers[index].sourceStart + (layer.animation?.held ? 0 : previous.duration)));
    if(continues) {
      previous.duration += span.duration;
      previous.layers = previous.layers.map(layer => ({...layer, duration: previous.duration}));
    } else result.push({...span, audio: [], layers: span.layers.map(layer => ({...layer}))});
  }
  return result;
}
