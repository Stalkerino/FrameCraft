import type {NativeSceneSpan} from '../../../shared/native-scene-plan';
import type {ExportSettings} from '../../../shared/media-settings';

/** Conservative admission estimate, not driver VRAM telemetry or a hard pool
 * limit. Batches sum these estimates for all branches opened in one process.
 */
export function nativeSceneResources(span: NativeSceneSpan, settings: Pick<ExportSettings, 'width' | 'height'>, budgetMiB = Number(process.env.FRAMECRAFT_GPU_BUDGET_MIB || 1024)) {
  if(!Number.isFinite(budgetMiB) || budgetMiB < 128 || budgetMiB > 16384) throw new Error('FRAMECRAFT_GPU_BUDGET_MIB must be between 128 and 16384.');
  const estimate = (scene: NativeSceneSpan, width: number, height: number): number => {
    const output = width * height;
    return output * 8 * (4 + scene.layers.filter(layer => layer.animation).length * 4) + scene.layers.reduce((sum, layer) => {
      if(layer.scene) return sum + estimate(layer.scene.span, layer.scene.width, layer.scene.height) + layer.scene.width * layer.scene.height * 8 * 4;
      if(layer.artwork || layer.textClip) return sum + 16 * 1024 ** 2;
      return sum + layer.asset.width! * layer.asset.height! * ((layer.asset.kind === 'image' ? 4 : 1.5 * 24) + 8 * 2 + (layer.animation || layer.gradeStages?.length || layer.opacity < 1 ? 8 * 3 : 0));
    }, 0) + scene.layers.reduce((sum,layer)=>sum+layer.gradeStages.reduce((n,stage)=>n+(stage.lut?stage.lut.size**3*16*2:0),0),0);
  };
  const bytes = 64 * 1024 ** 2 + estimate(span, settings.width, settings.height);
  const estimatedMiB = Math.ceil(bytes / 1024 ** 2);
  if(estimatedMiB > budgetMiB) throw new Error(`Native composition estimates ${estimatedMiB} MiB for ${span.layers.length} simultaneous visual layers; configured GPU budget is ${budgetMiB} MiB. Reduce source/output resolution or explicitly set FRAMECRAFT_GPU_BUDGET_MIB to suit this GPU. No GPU work was started.`);
  return {estimatedMiB, budgetMiB};
}
