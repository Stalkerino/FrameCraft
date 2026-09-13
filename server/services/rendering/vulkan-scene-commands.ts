import type {FilterFileOption} from '../filter-file-service';
import type {ExportSettings} from '../../../shared/media-settings';
import type {NativeSceneSpan, NativeVisualLayer} from '../../../shared/native-scene-plan';
import type {VideoPlacement} from '../../../shared/video-placement';
import {audioVolumeFilter} from '../../../shared/audio-envelope';
import type {NativeGpuSegment} from '../../../shared/native-gpu-plan';
import type {VulkanPipeline} from './vulkan-pipeline-service';
import {gpuColorShader} from '../../../shared/gpu-color-effects';
import {gpuAnimationShader} from '../../../shared/gpu-animation';
import type {GpuVisualArtwork} from '../../../shared/gpu-artwork';

const decimal = (value: number) => {
  if(!Number.isFinite(value)) throw new Error('Non-finite native scene geometry.');
  return Number(value.toFixed(10)).toString();
};
// Flat expressions avoid nested parser depth limits on larger timelines.
const perInput = (values: number[]) => `'${values.map((value, index) => `eq(idx,${index})*${decimal(value)}`).join('+')}'`;

export const imageColorTags = 'setparams=range=full:colorspace=gbr:color_primaries=bt709:color_trc=iec61966-2-1';
export function vulkanLayerEffect(layer: NativeVisualLayer) {
  return layer.gradeStages?.length || layer.opacity < 1
    ? `,libplacebo=format=rgba:alpha_mode=straight:custom_shader_bin=${Buffer.from(gpuColorShader(layer.gradeStages ?? [], layer.opacity)).toString('hex')}:deband=0:peak_detect=0,format=pix_fmts=vulkan` : '';
}
export interface SceneGraphBindings {prefix: string; inputs: string[]; preparedImages: boolean; output: string; artwork?: Map<string, GpuVisualArtwork>; outputFormat?: 'rgba'; sourceInputs?: Map<NativeVisualLayer, string>}
export function vulkanSceneGraph(span: NativeSceneSpan, settings: ExportSettings, background: string, bindings?: SceneGraphBindings) {
  const tag = (name: string) => (bindings?.prefix ?? '') + name;
  const graph = [`color_vulkan=c=${background}:s=2x2:r=${settings.fps}:format=rgba,trim=end_frame=${span.duration},setpts=N/(${settings.fps}*TB),${imageColorTags}[${tag('canvas')}]`];
  span.layers.forEach((layer, index) => {
    const image = !layer.scene && layer.asset.kind === 'image';
    const generated = layer.artwork || layer.textClip;
    let input = bindings?.sourceInputs?.get(layer) ?? bindings?.inputs[index] ?? `${index}:v:0`;
    if(layer.scene) {
      input = tag(`group${index}`);
      graph.push(vulkanSceneGraph(layer.scene.span, {...settings, width: layer.scene.width, height: layer.scene.height, fit: 'contain'}, layer.scene.background,
        {...bindings, preparedImages: bindings?.preparedImages ?? false, prefix: `${input}_`, inputs: [], output: input, outputFormat: 'rgba'}));
    }
    const source = generated ? `color_vulkan=c=black@0:s=2x2:r=${settings.fps}:format=rgba,${imageColorTags}` : image ? `${bindings?.preparedImages ? 'format=pix_fmts=vulkan' : 'format=rgba,hwupload'},loop=loop=-1:size=1:start=0,${imageColorTags}` : 'format=pix_fmts=vulkan';
    // Normalize tagged SDR source RGB before creative corrections. libplacebo keeps
    // the conversion on the source Vulkan device; the output encode remains BT.709.
    const inputColor = !image && !generated && !layer.scene ? ',libplacebo=format=rgba:colorspace=gbr:color_primaries=bt709:color_trc=iec61966-2-1:range=pc:alpha_mode=straight:deband=0:peak_detect=0,format=pix_fmts=vulkan' : '';
    const effect = layer.animation
      ? `,libplacebo=w=${settings.width}:h=${settings.height}:format=rgba:alpha_mode=straight:custom_shader_bin=${Buffer.from(gpuAnimationShader(layer, settings, background, bindings?.artwork?.get(layer.clipId))).toString('hex')}:frame_mixer=none:deband=0:peak_detect=0:disable_linear=1,format=pix_fmts=vulkan`
      : image && bindings?.preparedImages ? '' : vulkanLayerEffect(layer);
    const hold = !image && (layer.holdFrame || layer.animation?.held) ? ',trim=end_frame=1,loop=loop=-1:size=1:start=0' : '';
    graph.push(`${generated ? '' : `[${input}]`}${source}${inputColor},setpts=PTS-STARTPTS,fps=fps=${settings.fps}:start_time=0${hold},trim=end_frame=${span.duration},setpts=N/(${settings.fps}*TB)${effect}[${tag(`layer${index}`)}]`);
  });
  const placements: VideoPlacement[] = [{source: {x: 0, y: 0, width: 2, height: 2}, destination: {x: 0, y: 0, width: settings.width, height: settings.height}}, ...span.layers.map(layer => layer.placement)];
  const geometry = (['x', 'y', 'width', 'height'] as const).flatMap(key => {
    const suffix = key === 'width' ? 'w' : key === 'height' ? 'h' : key;
    return [`crop_${suffix}=${perInput(placements.map(p => p.source[key]))}`, `pos_${suffix}=${perInput(placements.map(p => p.destination[key]))}`];
  });
  // GPU-only input/output constraints prevent libplacebo's software frame
  // upload/download paths. All layers are composed before the single encode.
  graph.push(`[${tag('canvas')}]${span.layers.map((_, index) => `[${tag(`layer${index}`)}]`).join('')}libplacebo=inputs=${placements.length}:w=${settings.width}:h=${settings.height}:format=${bindings?.outputFormat ?? 'nv12'}:fps=${settings.fps}:${geometry.join(':')}:upscaler=lanczos:downscaler=lanczos:frame_mixer=none:deband=0:peak_detect=0:disable_linear=1:colorspace=${bindings?.outputFormat === 'rgba' ? 'gbr' : 'bt709'}:color_primaries=bt709:color_trc=${bindings?.outputFormat === 'rgba' ? 'iec61966-2-1' : 'bt709'}:range=${bindings?.outputFormat === 'rgba' ? 'pc' : 'tv'},format=pix_fmts=vulkan,setsar=1,trim=end_frame=${span.duration}[${bindings?.output ?? 'video'}]`);
  return graph.join(';\n');
}

export function vulkanSceneVideoArguments(span: NativeSceneSpan, settings: ExportSettings, files: string[], graphFile: string, output: string, pipeline: VulkanPipeline) {
  return vulkanVideoArguments(span.layers, span.duration, settings, files, graphFile, output, pipeline);
}

export function vulkanVideoArguments(inputs: NativeVisualLayer[], frameCount: number, settings: ExportSettings, files: string[], graphFile: string, output: string, pipeline: VulkanPipeline, bufferedFrames?: number) {
  if(files.length !== inputs.length) throw new Error('Every native visual input must have one source.');
  const args = ['-hide_banner', '-loglevel', process.env.FRAMECRAFT_GPU_DEBUG === '1' ? 'verbose' : 'error', '-nostdin', '-xerror', '-noauto_conversion_filters', ...pipeline.initialize];
  if(bufferedFrames !== undefined) args.push('-filter_buffered_frames', String(bufferedFrames));
  for(const [index, layer] of inputs.entries()) {
    if(layer.asset.kind === 'image') args.push('-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${layer.asset.width}x${layer.asset.height}`, '-framerate', String(settings.fps), '-i', files[index]);
    else args.push('-hwaccel', 'vulkan', '-hwaccel_device', 'fc', '-hwaccel_output_format', 'vulkan',
      '-extra_hw_frames', '2', '-threads', '2', '-noautorotate', '-ss', String(layer.sourceStart / settings.fps), '-i', files[index]);
  }
  args.push('-filter_complex_threads', '1', '-/filter_complex', graphFile, '-map', '[video]', '-an', '-sn', '-dn', '-map_metadata', '-1',
    '-c:v', pipeline.encoder, '-pix_fmt', '+vulkan', '-r', String(settings.fps), '-bf', '0', '-async_depth', '2', '-g', String(Math.max(1, Math.round(settings.fps * 2))),
    ...(settings.qualityMode === 'quality' ? ['-rc_mode', 'cqp', '-qp', String(settings.codec === 'av1' ? Math.round(settings.crf / 63 * 255) : Math.min(51, settings.crf))]
      : ['-rc_mode', 'vbr', '-b:v', `${settings.videoBitrate}M`, '-maxrate', `${settings.videoBitrate * 1.5}M`]),
    '-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range:v', 'tv',
    '-frames:v', String(frameCount), '-progress', 'pipe:1', '-nostats', '-f', 'nut', '-y', output);
  return args;
}

export interface SceneAudioInput {segment: NativeGpuSegment; file: string}
export function sceneAudioGraph(inputs: SceneAudioInput[], settings: ExportSettings, sampleCount: number) {
  const filters = inputs.map(({segment}, index) => `[${index}:a:0]asetpts=PTS-STARTPTS,aresample=${settings.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,${[audioVolumeFilter(segment.audioEnvelope, settings.fps, segment.volume), ...(segment.audioGains ?? []).map(gain => audioVolumeFilter(gain.envelope, settings.fps, gain.volume))].join(',')},apad=whole_len=${sampleCount},atrim=end_sample=${sampleCount}[audio${index}]`);
  if(inputs.length) filters.push(`${inputs.map((_, index) => `[audio${index}]`).join('')}amix=inputs=${inputs.length}:normalize=0:duration=longest:dropout_transition=0,atrim=end_sample=${sampleCount}[audio]`);
  else filters.push(`[0:a:0]atrim=end_sample=${sampleCount}[audio]`);
  return filters.join(';\n');
}

export function sceneAudioArguments(inputs: SceneAudioInput[], settings: ExportSettings, graphFile: string, output: string, filterOption: FilterFileOption = '-/filter_complex') {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  for(const input of inputs) args.push('-threads', '1', '-ss', String(input.segment.sourceStart / settings.fps), '-t', String(input.segment.duration / settings.fps), '-vn', '-sn', '-dn', '-i', input.file);
  if(!inputs.length) args.push('-f', 'lavfi', '-i', `anullsrc=r=${settings.sampleRate}:cl=stereo`);
  // Envelopes can be long. Load the graph from a file rather than exceeding
  // the Windows process command-line limit with thousands of keyframes.
  args.push('-filter_complex_threads', '1', filterOption, graphFile, '-map', '[audio]', '-vn', '-ac', '2', '-ar', String(settings.sampleRate), '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}
