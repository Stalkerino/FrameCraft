import {previewProfiles, type PreviewQuality} from '../../shared/media-import';
import type {Asset} from '../../shared/project';
import {exportSettingsSchema} from '../../shared/media-settings';
import {hardwareEncodingArguments, type HardwareEncoder} from './encoding-arguments';
import type {NativeGpuAdapter} from './rendering/native-gpu-adapters';

export function previewDimensions(asset: Asset, quality: PreviewQuality) {
  if(!asset.width || !asset.height) throw new Error('Source dimensions are required for GPU proxies.');
  if(quality === 'high') return {width: Math.ceil(asset.width / 2) * 2, height: Math.ceil(asset.height / 2) * 2};
  const profile = previewProfiles[quality];
  const scale = Math.min(1, profile.width / asset.width, profile.height / asset.height);
  return {width: Math.max(2, Math.floor(asset.width * scale / 2) * 2), height: Math.max(2, Math.floor(asset.height * scale / 2) * 2)};
}

export function gpuPreviewArguments(asset: Asset, quality: PreviewQuality, input: string, output: string, encoder: HardwareEncoder, adapter: NativeGpuAdapter) {
  const settings = exportSettingsSchema.parse({...previewDimensions(asset, quality), fps: asset.fps || 30, codec: 'h264', crf: quality === 'high' ? 18 : 20, preset: 'veryfast', qualityMode: 'quality'});
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-noauto_conversion_filters', ...adapter.initialize,
    '-hwaccel', adapter.decoder, '-hwaccel_device', 'fc', '-hwaccel_output_format', adapter.inputFormat,
    '-extra_hw_frames', '4', '-threads', '2', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-filter_threads', '1', '-vf', `format=pix_fmts=${adapter.inputFormat},${adapter.scale(settings)}`,
    '-c:v', encoder.name, '-g', '1', '-bf', '0', '-fps_mode', 'passthrough',
    // Audio conversion is explicit because automatic conversion is disabled
    // to keep the video graph on hardware surfaces.
    '-af', 'aresample=48000:osf=fltp', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output];
  const result = hardwareEncodingArguments(args, encoder, settings, true, {initializeDevice: false});
  result.splice(result.length - 1, 0, '-pix_fmt', `+${adapter.outputFormat}`, ...adapter.encoderOptions);
  return result;
}

/** Separate cache generation: legacy long-GOP copies are not editing proxies. */
export function previewMediaSource(src: string, quality: PreviewQuality) {
  return src.replace(/\.[^/.]+$/, '') + (quality === 'high' ? '-preview-full-v1.mp4' : `-preview-${previewProfiles[quality].height}p-intra-v1.mp4`);
}

export function previewVideoArguments(quality: PreviewQuality) {
  const {width, height} = previewProfiles[quality];
  // Bound both axes, retain aspect ratio, never upscale, and retain source timestamps.
  const filter = quality === 'high' ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2' :
    `scale=w='max(2,trunc(iw*min(1,min(${width}/iw,${height}/ih))/2)*2)':h='max(2,trunc(ih*min(1,min(${width}/iw,${height}/ih))/2)*2)':flags=bilinear`;
  return ['-vf', filter, '-filter_threads', '1', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast',
    '-crf', quality === 'high' ? '18' : '20', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
    ...(quality === 'high' ? [] : ['-g', '1', '-keyint_min', '1', '-bf', '0'])];
}
