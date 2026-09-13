import {sceneLayers, sourceLayers} from '../../../shared/native-sequence-plan';
import type {NativeSceneSpan, NativeVisualLayer} from '../../../shared/native-scene-plan';
import type {ExportSettings} from '../../../shared/media-settings';
import {continuousVisualSpans} from '../../../shared/native-visual-spans';
import {nativeSceneResources} from './native-scene-resources';
import {imageColorTags, vulkanLayerEffect, vulkanSceneGraph} from './vulkan-scene-commands';
import type {GpuVisualArtwork} from '../../../shared/gpu-artwork';

export interface VulkanBatch {spans: NativeSceneSpan[]; start: number; duration: number; estimatedMiB: number; bufferedFrames: number}

/** Bounded groups keep a device/encoder alive across cuts. Memory estimates
 * add ALL branches, not only simultaneously visible layers. They are admission
 * estimates, not driver VRAM telemetry. No device is opened during planning.
 */
export function vulkanBatches(spans: NativeSceneSpan[], settings: ExportSettings, options: {budgetMiB?: number; maxSpans?: number} = {}): VulkanBatch[] {
  const maxSpans = options.maxSpans ?? Number(process.env.FRAMECRAFT_GPU_BATCH_SPANS || 4);
  if(!Number.isInteger(maxSpans) || maxSpans < 1 || maxSpans > 8) throw new Error('FRAMECRAFT_GPU_BATCH_SPANS must be an integer from 1 to 8.');
  const batches: VulkanBatch[] = [];
  for(const span of continuousVisualSpans(spans)) {
    const resource = nativeSceneResources(span, settings, options.budgetMiB);
    let batch = batches.at(-1);
    if(!batch || batch.spans.length >= maxSpans || batch.estimatedMiB + resource.estimatedMiB > resource.budgetMiB) {
      batch = {spans: [], start: span.start, duration: 0, estimatedMiB: 0, bufferedFrames: 0}; batches.push(batch);
    }
    batch.spans.push(span); batch.duration += span.duration; batch.estimatedMiB += resource.estimatedMiB;
    // Bound graph queues; reference surfaces and driver pools are estimated
    // separately by nativeSceneResources. Exceeding this aborts, never retries.
    batch.bufferedFrames = Math.max(16, batch.spans.reduce((count, value) => count + sceneLayers(value).length * 4 + 4, 8));
  }
  return batches;
}

/** GPU image uploads and each grading variant are shared before splitting a
 * single hardware frame into the scene loops. No queue contains a raw video.
 */
export function vulkanBatchGraph(batch: VulkanBatch, settings: ExportSettings, background: string, artwork?: Map<string, GpuVisualArtwork>) {
  const inputs: NativeVisualLayer[] = []; const graph: string[] = [];
  const images = new Map<string, {input: number; variants: Map<string, {layer: NativeVisualLayer; labels: string[]}>}>();
  const sourceInputs = new Map<NativeVisualLayer, string>();
  batch.spans.forEach((span, scene) => sourceLayers(span).forEach((layer, index) => {
    if(layer.artwork || layer.textClip) return;
    if(layer.asset.kind !== 'image') {const input = inputs.length; inputs.push(layer); sourceInputs.set(layer, `${input}:v:0`); return;}
    let image = images.get(layer.asset.id);
    if(!image) {image = {input: inputs.length, variants: new Map()}; images.set(layer.asset.id, image); inputs.push(layer);}
    const key = layer.animation ? 'animated-source' : JSON.stringify([layer.opacity, layer.gradeStages]);
    let variant = image.variants.get(key);
    if(!variant) {variant = {layer, labels: []}; image.variants.set(key, variant);}
    const label = `image_${scene}_${index}`; variant.labels.push(label); sourceInputs.set(layer, label);
  }));
  const split = (targets: string[]) => `${targets.length === 1 ? 'null' : `split=${targets.length}`}${targets.map(label => `[${label}]`).join('')}`;
  for(const image of images.values()) {
    const variants = [...image.variants.values()];
    graph.push(`[${image.input}:v:0]format=rgba,hwupload,${imageColorTags},${split(variants.map((_, index) => `texture_${image.input}_${index}`))}`);
    variants.forEach((variant, index) => graph.push(`[texture_${image.input}_${index}]null${variant.layer.animation ? '' : vulkanLayerEffect(variant.layer)},${split(variant.labels)}`));
  }
  batch.spans.forEach((span, index) => graph.push(vulkanSceneGraph(span, settings, background, {
    prefix: `s${index}_`, inputs: [], sourceInputs, preparedImages: true, output: `scene_${index}`, artwork,
  })));
  graph.push(`${batch.spans.map((_, index) => `[scene_${index}]`).join('')}${batch.spans.length === 1 ? 'null' : `concat=n=${batch.spans.length}:v=1:a=0`},format=pix_fmts=vulkan,setpts=N/(${settings.fps}*TB),trim=end_frame=${batch.duration}[video]`);
  return {graph: graph.join(';\n'), inputs};
}
