import {sceneLayers} from '../../../shared/native-sequence-plan';
import type {NativeScenePlan} from '../../../shared/native-scene-plan';
import {presetString, resolvePresetValues, type PresetInstance} from '../../../shared/asset-presets';
import {gpuPresetProgram, type GpuVisualArtwork, type GpuTextOutline, type GpuArtworkProgram} from '../../../shared/gpu-artwork';
import {GpuFontService} from './gpu-font-service';
import {prepareGpuText} from './gpu-text-service';

/** Prepare saved recipe snapshots once per export, before opening a GPU. */
export async function prepareGpuArtwork(plan: NativeScenePlan, fps: number) {
  const fonts = new GpuFontService(); const prepared = new Map<string, GpuVisualArtwork>();
  const compile = async (instance: PresetInstance, name: string) => {
    const values = resolvePresetValues(instance.definition, instance.values); const texts = new Map<string, GpuTextOutline>();
    for(const [index, layer] of instance.definition.layers.entries()) if(layer.type === 'text') {
      texts.set(layer.id, await fonts.outline(presetString(layer.text, values), layer.weight, layer.align, `${name}_text_${index}`));
    }
    return gpuPresetProgram(instance, name, texts);
  };
  for(const span of plan.spans) for(const layer of sceneLayers(span)) if(!prepared.has(layer.clipId)) {
    const graphic = layer.artwork;
    const transition = layer.animation?.clip.presetTransition;
    if(graphic || transition || layer.textClip) {
      const clip = layer.textClip;
      const visual = {graphic: clip ? await prepareGpuText(fonts, plan, clip, fps, layer.animation!.project.width) : graphic ? await compile(graphic, 'fc_graphic') : undefined, transition: transition ? await compile(transition, 'fc_transition') : undefined};
      packTextGeometry([visual.graphic, visual.transition].filter((p): p is GpuArtworkProgram => !!p));
      prepared.set(layer.clipId, visual);
    }
  }
  return prepared;
}

/** A single geometry texture avoids descriptor limits with 40 text layers.
 * This packs vector coordinates, not glyph bitmaps or rendered video frames.
 */
function packTextGeometry(programs: GpuArtworkProgram[]) {
  const entries = programs.flatMap(program => program.textures.map((texture, index) => {
    const size = texture.match(/\/\/!SIZE (\d+) (\d+)/)!;
    return {program, binding: program.bindings[index], width: Number(size[1]), data: Buffer.from(texture.split('\n').filter(line => !line.startsWith('//!')).join('').trim(), 'hex')};
  }));
  if(!entries.length) return;
  const total = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  if(total > 16 * 1024 ** 2) throw new Error('This asset exceeds the 16 MiB GPU font geometry budget.');
  const width = 1024; const height = Math.max(2, Math.ceil(total / 16 / width));
  const data = Buffer.alloc(width * height * 16); let offset = 0;
  for(const entry of entries) {
    entry.data.copy(data, offset);
    const helper = `fc_fetch_${entry.binding}`;
    entry.program.functions = entry.program.functions.map(fn => fn.replaceAll(`texelFetch(${entry.binding},`, `${helper}(`));
    entry.program.functions.unshift(`vec4 ${helper}(ivec2 p,int lod){int i=p.x+p.y*${entry.width}+${offset / 16};return texelFetch(fc_asset_geometry,ivec2(i%${width},i/${width}),0);}`);
    offset += entry.data.length;
  }
  for(const program of programs) {program.textures = []; program.bindings = ['fc_asset_geometry'];}
  programs[0].textures = [`//!TEXTURE fc_asset_geometry\n//!SIZE ${width} ${height}\n//!FORMAT rgba32f\n//!FILTER NEAREST\n${data.toString('hex')}\n`];
}
