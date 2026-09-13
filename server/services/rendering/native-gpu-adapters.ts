import type {ExportSettings} from '../../../shared/media-settings';
import type {HardwareEncoder} from '../encoding-arguments';
import {runProcess} from '../process-service';

export interface NativeGpuAdapter {
  id: 'amd-linux' | 'amd-windows' | 'nvidia-linux' | 'nvidia-windows';
  label: string;
  decoder: 'vaapi' | 'cuda' | 'd3d11va';
  inputFormat: 'vaapi' | 'cuda' | 'd3d11';
  outputFormat: 'vaapi' | 'cuda' | 'amf';
  filter: string;
  initialize: string[];
  scale: (settings: Pick<ExportSettings, 'width' | 'height'>) => string;
  encoderOptions: string[];
}

/** No device initialization here. Device sharing is explicit and vendor-local;
 * there is no VA-API/Vulkan or cross-device interop in this increment.
 */
export function nativeGpuAdapter(encoder: HardwareEncoder, platform: NodeJS.Platform = process.platform): NativeGpuAdapter {
  if(platform !== 'linux' && platform !== 'win32') throw new Error('Native GPU rendering currently targets Windows and Linux.');
  if(encoder.vendor === 'nvidia' && encoder.backend === 'nvenc') return {
    id: platform === 'win32' ? 'nvidia-windows' : 'nvidia-linux', label: 'CUDA decode → CUDA scale → NVENC',
    decoder: 'cuda', inputFormat: 'cuda', outputFormat: 'cuda', filter: 'scale_cuda',
    initialize: ['-init_hw_device', `cuda=fc:${encoder.device ?? '0'}`, '-filter_hw_device', 'fc'],
    scale: ({width, height}) => `scale_cuda=w=${width}:h=${height}:format=nv12:interp_algo=lanczos:passthrough=0`,
    encoderOptions: ['-rc-lookahead', '0', '-surfaces', '8'],
  };
  if(platform === 'linux' && encoder.vendor === 'amd' && encoder.backend === 'vaapi' && encoder.device) return {
    id: 'amd-linux', label: 'VA-API decode → VA-API scale → VA-API encode',
    decoder: 'vaapi', inputFormat: 'vaapi', outputFormat: 'vaapi', filter: 'scale_vaapi',
    initialize: ['-init_hw_device', `vaapi=fc:${encoder.device}`, '-filter_hw_device', 'fc'],
    scale: ({width, height}) => `scale_vaapi=w=${width}:h=${height}:format=nv12`,
    encoderOptions: ['-async_depth', '2'],
  };
  if(platform === 'win32' && encoder.vendor === 'amd' && encoder.backend === 'amf') return {
    id: 'amd-windows', label: 'D3D11 decode → AMF scale → AMF encode',
    decoder: 'd3d11va', inputFormat: 'd3d11', outputFormat: 'amf', filter: 'vpp_amf',
    // Vendor selection avoids decoding on Intel/NVIDIA in mixed-GPU laptops.
    // AMF derives from the SAME D3D11 device and wraps its textures on GPU.
    initialize: ['-init_hw_device', 'd3d11va=fc:,vendor_id=0x1002', '-init_hw_device', 'amf=fc_amf@fc', '-filter_hw_device', 'fc_amf'],
    scale: ({width, height}) => `vpp_amf=${width}:${height}:format=nv12:scale_type=bicubic`,
    encoderOptions: [],
  };
  throw new Error(`No native GPU adapter for ${encoder.vendor}/${platform}/${encoder.backend}.`);
}

/** Listing FFmpeg interfaces never tests the GPU. Do not try another device
 * after an actual render failure: repeated driver initialization is unsafe on
 * affected desktops, and would conceal the failing stage.
 */
export async function selectNativeGpuAdapter(candidates: HardwareEncoder[]) {
  const failures: string[] = [];
  for(const encoder of candidates) {
    try {
      const adapter = nativeGpuAdapter(encoder);
      const filters = await runProcess(encoder.binary, ['-hide_banner', '-filters'], 10000);
      if(!new RegExp(`^\\s*\\S+\\s+${adapter.filter}\\s`, 'm').test(filters)) throw new Error(`${adapter.filter} is not included in this FFmpeg build`);
      const accelerators = await runProcess(encoder.binary, ['-hide_banner', '-hwaccels'], 10000);
      if(!accelerators.split(/\s+/).includes(adapter.decoder) || adapter.outputFormat === 'amf' && !accelerators.split(/\s+/).includes('amf')) throw new Error(`${adapter.decoder}/${adapter.outputFormat} hardware interfaces are not included in this FFmpeg build`);
      return {encoder, adapter};
    } catch(error) {failures.push(`${encoder.binary}: ${(error as Error).message}`);}
  }
  throw new Error(`No complete native GPU adapter is listed. Install an FFmpeg build with the required decoder, scaler and encoder.\n${failures.join('\n')}`);
}
