import type {GpuVendor, EncoderCapabilities} from '../../../shared/encoding';
import type {ExportSettings} from '../../../shared/media-settings';
import {ffmpegPath, runProcess} from '../process-service';
import {bundledRenderBinary, resolveExecutable} from '../render-binaries-service';
import {gpuDisabled} from './gpu-policy';
import path from 'node:path';
import {rootDir} from '../../config';
import runtime from '../../../shared/vulkan-runtime.json';

export interface VulkanPipeline {binary: string; encoder: string; vendor: GpuVendor; label: string; initialize: string[]}
interface VulkanInventory {binary?: string; encoder: string; reason?: string}

/** One Vulkan device from decode through rendering to encode. Never derive a
 * Vulkan device from VA-API/D3D11/CUDA or transfer frames between API backends.
 */
export function vulkanPipeline(binary: string, codec: ExportSettings['codec'], vendor: GpuVendor, platform: NodeJS.Platform = process.platform, requestedDevice?: string): VulkanPipeline {
  if(platform !== 'linux' && platform !== 'win32') throw new Error('Native Vulkan rendering targets Windows and Linux.');
  const encoder = `${codec === 'h265' ? 'hevc' : codec === 'h264-mkv' ? 'h264' : codec}_vulkan`;
  const vendorName = vendor === 'amd' ? 'AMD' : 'NVIDIA';
  const deviceName = requestedDevice?.trim() || vendorName;
  if(!deviceName.toUpperCase().includes(vendorName) || /[,:\r\n]/.test(deviceName)) throw new Error(`FRAMECRAFT_VULKAN_DEVICE must be a ${vendorName} device-name substring without commas or colons; numeric indices and other vendors are not accepted.`);
  // FFmpeg's documented substring selector fails when the requested vendor is
  // missing; index 0 could silently select the wrong adapter on mixed laptops.
  return {binary, encoder, vendor, label: `${vendorName} Vulkan Video`, initialize: ['-init_hw_device', `vulkan=fc:${deviceName}`, '-filter_hw_device', 'fc']};
}

export class VulkanPipelineService {
  private cache = new Map<string, {until: number; value: Promise<VulkanInventory>}>();
  private inventory(codec: ExportSettings['codec']) {
    const cached = this.cache.get(codec); if(cached && cached.until > Date.now()) return cached.value;
    const value = this.inspect(codec);
    this.cache.set(codec, {until: Date.now() + 60000, value});
    void value.catch(() => this.cache.delete(codec));
    return value;
  }

  async capabilities(codec: ExportSettings['codec']): Promise<EncoderCapabilities> {
    const listed = gpuDisabled() ? {reason: 'GPU use is disabled in this process.'} : await this.inventory(codec);
    return {codec, verification: 'not-run', encoders: (['amd', 'nvidia'] as const).map(id => ({id, label: `${id === 'amd' ? 'AMD' : 'NVIDIA'} Vulkan Video`,
      available: 'binary' in listed && !!listed.binary, encoder: 'encoder' in listed ? listed.encoder : undefined,
      reason: listed.reason ?? 'Complete FFmpeg Vulkan interfaces listed. This does not verify the physical GPU, its driver or Vulkan Video codec support.'}))};
  }

  async select(settings: ExportSettings) {
    if(gpuDisabled()) throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
    if(settings.encoder !== 'amd' && settings.encoder !== 'nvidia') throw new Error('Choose AMD or NVIDIA for native Vulkan rendering.');
    const inventory = await this.inventory(settings.codec);
    if(!inventory.binary) throw new Error(inventory.reason);
    return vulkanPipeline(inventory.binary, settings.codec, settings.encoder, process.platform, process.env.FRAMECRAFT_VULKAN_DEVICE);
  }

  private async inspect(codec: ExportSettings['codec']): Promise<VulkanInventory> {
    const encoder = `${codec === 'h265' ? 'hevc' : codec === 'h264-mkv' ? 'h264' : codec}_vulkan`;
    if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(codec)) return {encoder, reason: 'Vulkan Video requires H.264, H.265 or AV1 output.'};
    const override = process.env.FRAMECRAFT_VULKAN_FFMPEG;
    const managed = path.join(rootDir, '.runtime/vulkan', runtime.release, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    // FFmpeg 9 with libplacebo < API 365 rejects internally synchronized
    // Vulkan queues. Prefer the coherent packaged build, not a driver retry.
    const binaries = [...new Set((await Promise.all((override ? [override] : [managed, ffmpegPath(), bundledRenderBinary('ffmpeg')]).map(resolveExecutable))).filter((value): value is string => !!value))];
    const failures: string[] = [];
    for(const binary of binaries) {
      try {
        // Every command here is a metadata listing. No device creation, video
        // input, synthetic encoding, Vulkan loader query or hardware retry.
        const encoders = await runProcess(binary, ['-hide_banner', '-encoders'], 10000);
        if(!new RegExp(`^\\s*V\\S*\\s+${encoder}\\s`, 'm').test(encoders)) throw new Error(`missing ${encoder}`);
        const filters = await runProcess(binary, ['-hide_banner', '-filters'], 10000);
        for(const name of ['libplacebo', 'color_vulkan']) if(!new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(filters)) throw new Error(`missing ${name}`);
        const accelerators = await runProcess(binary, ['-hide_banner', '-hwaccels'], 10000);
        if(!accelerators.split(/\s+/).includes('vulkan')) throw new Error('missing Vulkan hardware device support');
        const options = await runProcess(binary, ['-hide_banner', '-h', 'filter=libplacebo'], 10000);
        if(!/\binputs\s+<int>/.test(options)) throw new Error('libplacebo does not support multiple inputs');
        return {binary, encoder};
      } catch(error) {failures.push(`${binary}: ${(error as Error).message}`);}
    }
    return {encoder, reason: `Native Vulkan composition needs a compatible FFmpeg/libplacebo runtime. Run npm run setup:gpu, or set FRAMECRAFT_VULKAN_FFMPEG.\n${failures.join('\n')}`};
  }
}
