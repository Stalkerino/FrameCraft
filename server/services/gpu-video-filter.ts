import type {VideoSegment} from '../../shared/layered-render-plan';
import type {ExportSettings} from '../../shared/media-settings';
import type {HardwareEncoder} from './encoding-arguments';
import {ProcessError, runProcess} from './process-service';

export interface GpuVideoFilter {base: string; finish: string; overlay: boolean; label: string}

/** Exercise the actual padding/overlay allocation geometry against a tiny CPU
 * reference before enabling it on either Windows or Linux. A working encoder
 * or a filter listing does not prove pixel correctness on an older build. */
export async function supportsCudaGeometry(encoder: HardwareEncoder): Promise<boolean> {
  const capture = async (args: string[]) => {
    const chunks: Buffer[] = [];
    await runProcess(encoder.binary, ['-v', 'error', '-nostdin', ...args, '-frames:v', '1', '-an', '-f', 'rawvideo', '-'], 15000, {onOutput: chunk => chunks.push(chunk)});
    return Buffer.concat(chunks);
  };
  const source = ['-f', 'lavfi', '-i', 'nullsrc=s=32x32:r=1,geq=lum=128:cb=128:cr=128'];
  try {
    const reference = await capture([...source, '-vf', 'format=yuv420p,pad=64:48:16:8']);
    const pixels = await capture(['-init_hw_device', `cuda=framecraft:${encoder.device ?? '0'}`, '-filter_hw_device', 'framecraft', ...source,
      '-f', 'lavfi', '-i', 'color=black@0:s=64x48:r=1,format=yuva420p', '-filter_complex',
      '[0:v]format=yuv420p,hwupload,scale_cuda=32:32:format=yuv420p:passthrough=0,pad_cuda=64:48:16:8[base];[1:v]hwupload[art];[base][art]overlay_cuda=0:0:repeatlast=1,crop=64:48:0:0:exact=1,scale_cuda=64:48:passthrough=0,hwdownload,format=yuv420p[out]', '-map', '[out]']);
    return pixels.length === 64 * 48 * 3 / 2 && pixels.length === reference.length && pixels.every((value, index) => Math.abs(value - reference[index]) <= 1);
  } catch(error) {
    if(error instanceof ProcessError && error.kind === 'abort') throw error;
    return false;
  }
}

/** CUDA filters operate on the same decoder surfaces used by NVENC. Artwork
 * remains the shared composition; only its sparse frames are uploaded.
 * Never approximate crops or odd chroma positions to gain acceleration.
 */
export function gpuVideoFilter(segment: VideoSegment, settings: ExportSettings, encoder: HardwareEncoder,
  filters: ReadonlySet<string>, overlay: boolean, colorFilter?: string): GpuVideoFilter | undefined {
  const asset = segment.asset;
  if(encoder.backend !== 'nvenc' || !asset || colorFilter || segment.placement === null
    || segment.sourceStart + segment.duration > Math.floor((asset.duration ?? 0) * settings.fps)) return;
  const placement = segment.placement ?? {source: {x: 0, y: 0, width: asset.width!, height: asset.height!},
    destination: {x: 0, y: 0, width: settings.width, height: settings.height}};
  const {source: s, destination: d} = placement;
  if(Math.abs(s.x) > 1e-6 || Math.abs(s.y) > 1e-6 || Math.abs(s.width - asset.width!) > 1e-6 || Math.abs(s.height - asset.height!) > 1e-6) return;
  const [x, y, width, height] = [d.x, d.y, d.width, d.height].map(Math.round);
  if([x, y, width, height, settings.width, settings.height].some(value => value % 2 !== 0)
    || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > settings.width || y + height > settings.height) return;
  const pad = x !== 0 || y !== 0 || width !== settings.width || height !== settings.height;
  if(!filters.has('scale_cuda') || pad && !filters.has('pad_cuda') || overlay && (!filters.has('overlay_cuda') || !filters.has('hwupload'))) return;
  // passthrough=0 releases decoder pool frames before sparse overlay framesync
  // retains them. Conversion from NV12 to planar YUV happens on the GPU too.
  const base = [`scale_cuda=${width}:${height}:interp_algo=lanczos:format=yuv420p:passthrough=0`,
    pad ? `pad_cuda=${settings.width}:${settings.height}:${x}:${y}:color=${(segment.backgroundColor ?? '#080c0e').replace('#', '0x')}` : ''].filter(Boolean).join(',');
  // pad/overlay frame pools may expose their 32-pixel allocation alignment when
  // making a surface writable. Reset the visible size on CUDA before NVENC;
  // otherwise e.g. a 640x360 composition can be encoded as 640x384.
  const finish = [pad || overlay ? `crop=${settings.width}:${settings.height}:0:0:exact=1,scale_cuda=${settings.width}:${settings.height}:passthrough=0` : '', 'setsar=1'].filter(Boolean).join(',');
  return {base, finish, overlay, label: `CUDA scaling${pad ? ' / positioning' : ''}${overlay ? ' / artwork compositing' : ''}`};
}
