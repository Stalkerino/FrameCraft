import type {Asset} from '../../../shared/project';
import {ffprobePath, runProcess} from '../process-service';
import {probeDuration, type ProbeTiming} from '../probe-timing';

export interface NativeGpuSource {audio: boolean; duration: number}
interface ProbeStream extends ProbeTiming {
  codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string;
  pix_fmt?: string; sample_aspect_ratio?: string; field_order?: string;
  color_space?: string; color_range?: string; color_transfer?: string; color_primaries?: string;
  tags?: {rotate?: string}; side_data_list?: {rotation?: number}[];
}

/** Read packet headers only, never decode pixels to test a device. A strict
 * SDR contract prevents relabeling HDR/full-range/unknown sources as BT.709.
 */
export function validateNativeGpuSource(data: {streams?: ProbeStream[]; format?: {duration?: string}}, asset: Asset, colorManaged = false): NativeGpuSource {
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  const fail = (reason: string): never => {throw new Error(`${asset.name}: ${reason} Native GPU export stopped; no software fallback was used.`);};
  if(!video) return fail('No video stream found.');
  if(!['h264', 'hevc', 'vp9', 'av1'].includes(video.codec_name ?? '')) return fail(`GPU decoding for ${video.codec_name ?? 'this codec'} is outside this increment.`);
  if(video.width !== asset.width || video.height !== asset.height) return fail('Source dimensions changed; reimport the media before rendering.');
  const rotation = Number(video.tags?.rotate ?? video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? 0);
  if(rotation % 360 !== 0) return fail('Source display rotation needs GPU transform support.');
  if(!['1:1', '0:1', undefined].includes(video.sample_aspect_ratio)) return fail('Anamorphic source pixels need GPU aspect correction.');
  if(!['progressive', 'unknown', undefined].includes(video.field_order)) return fail('Interlaced sources need GPU deinterlacing support.');
  if(colorManaged) {
    if(!['yuv420p','nv12','yuv420p10le','p010le'].includes(video.pix_fmt??'')) return fail('GPU color management supports progressive 8/10-bit 4:2:0 SDR sources.');
    if(!['bt709','bt2020nc','gbr'].includes(video.color_space??'') || !['bt709','iec61966-2-1','gamma22','gamma28','bt2020-10','bt2020-12'].includes(video.color_transfer??'') || !['bt709','bt2020','smpte432','smpte431'].includes(video.color_primaries??'') || !['tv','pc'].includes(video.color_range??'')) return fail('Source must have supported explicit SDR color tags. HDR PQ/HLG and untagged input are not silently reinterpreted as SDR.');
  } else {
    if(!['yuv420p', 'nv12'].includes(video.pix_fmt ?? '')) return fail('This increment supports 8-bit 4:2:0 video only.');
    if(video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709' || video.color_range !== 'tv') return fail('This increment requires explicitly tagged, limited-range BT.709 SDR media. HDR, other colorspaces and untagged media need the GPU color-management stage.');
  }
  const duration = probeDuration(video, data.format?.duration);
  if(!Number.isFinite(duration) || duration <= 0) return fail('The video duration could not be read.');
  return {audio: data.streams!.some(stream => stream.codec_type === 'audio'), duration};
}

export async function inspectNativeGpuSource(file: string, asset: Asset, colorManaged = false) {
  const data = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], 15000));
  return validateNativeGpuSource(data, asset, colorManaged);
}
