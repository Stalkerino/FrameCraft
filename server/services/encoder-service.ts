import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {ExportSettings} from '../../shared/media-settings';
import type {EncoderCapabilities, GpuVendor} from '../../shared/encoding';
import {ffmpegPath, runProcess} from './process-service';
import {bundledRenderBinary, resolveExecutable} from './render-binaries-service';
import {hardwareEncodingArguments, type HardwareEncoder} from './encoding-arguments';
import {gpuDisabled} from './rendering/gpu-policy';
import {VulkanPipelineService} from './rendering/vulkan-pipeline-service';

interface Detection {encoder?: HardwareEncoder; reason?: string}

export class EncoderService {
  private vulkan = new VulkanPipelineService();
  private capabilitiesCache = new Map<string, {expires: number; value: Promise<EncoderCapabilities>}>();

  /** Background proxies inspect hardware metadata only; no synthetic encodes. */
  async previewCandidates(): Promise<HardwareEncoder[]> {
    if(gpuDisabled() || process.env.FRAMECRAFT_PROXY_ENCODER === 'cpu') return [];
    const preferred = process.env.FRAMECRAFT_PROXY_ENCODER;
    const vendors = new Set<string>();
    if(preferred === 'amd' || preferred === 'nvidia') vendors.add(preferred);
    else if(process.platform === 'linux') {
      for(const name of await readdir('/sys/class/drm').catch(() => [] as string[])) {
        if(!/^renderD\d+$/.test(name)) continue;
        const vendor = (await readFile(path.join('/sys/class/drm', name, 'device/vendor'), 'utf8').catch(() => '')).trim();
        if(vendor === '0x1002') vendors.add('amd');
        if(vendor === '0x10de') vendors.add('nvidia');
      }
    } else if(process.platform === 'win32') {
      const devices = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty PNPDeviceID'], 10000).catch(() => '');
      if(/VEN_1002/i.test(devices)) vendors.add('amd');
      if(/VEN_10DE/i.test(devices)) vendors.add('nvidia');
    }
    if(!vendors.size) return [];
    return (await this.candidates('h264')).candidates.filter(candidate => vendors.has(candidate.vendor));
  }

  capabilities(codec: ExportSettings['codec'], renderer: ExportSettings['renderer'] = 'compatible') {
    if(renderer === 'native-vulkan') return this.vulkan.capabilities(codec);
    const cached = this.capabilitiesCache.get(codec);
    if(cached && cached.expires > Date.now()) return cached.value;
    const value = this.inspect(codec);
    this.capabilitiesCache.set(codec, {expires: Date.now() + 60000, value});
    void value.catch(() => this.capabilitiesCache.delete(codec));
    return value;
  }

  /** Metadata only. Native engines select a complete adapter without invoking
   * compatibility probes that upload CPU-generated frames or retry on hardware.
   */
  async nativeCandidates(settings: ExportSettings): Promise<HardwareEncoder[]> {
    if(gpuDisabled()) throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
    if(settings.encoder !== 'amd' && settings.encoder !== 'nvidia') throw new Error('Choose AMD or NVIDIA for native GPU rendering.');
    const {candidates, reason} = await this.candidates(settings.codec);
    const selected = candidates.filter(candidate => candidate.vendor === settings.encoder);
    if(!selected.length) throw new Error(reason || `No ${settings.encoder.toUpperCase()} encoder is listed for ${settings.codec}. Install a compatible FFmpeg build and GPU driver; FFMPEG_PATH selects the executable.`);
    return selected;
  }

  async select(settings: ExportSettings): Promise<{encoder?: HardwareEncoder; label: string; warning?: string}> {
    if(settings.encoder === 'cpu') return {label: 'CPU'};
    if(gpuDisabled()) {
      if(settings.encoder !== 'auto') throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
      return {label: 'CPU', warning: 'GPU use is disabled in this process.'};
    }
    const {candidates, reason} = await this.candidates(settings.codec);
    const vendors: GpuVendor[] = settings.encoder === 'auto' ? ['nvidia', 'amd'] : [settings.encoder];
    const failures: string[] = [];
    for(const vendor of vendors) {
      const detected = await this.detect(candidates.filter(candidate => candidate.vendor === vendor), settings, reason);
      if(detected.encoder) return {encoder: detected.encoder, label: detected.encoder.label};
      failures.push(`${vendor === 'amd' ? 'AMD' : 'NVIDIA'}: ${detected.reason}`);
    }
    if(settings.encoder !== 'auto') throw new Error(`GPU encoding is unavailable for these export settings. ${failures.join(' ')}`);
    return {label: 'CPU', warning: `Using CPU: no working GPU encoder for ${settings.codec.toUpperCase()}. ${reason || failures.join(' ')}`};
  }

  private async inspect(codec: ExportSettings['codec']): Promise<EncoderCapabilities> {
    if(gpuDisabled()) return {codec, verification: 'not-run', encoders: (['amd', 'nvidia'] as const).map(id => ({
      id, label: id === 'amd' ? 'AMD GPU' : 'NVIDIA NVENC', available: false, reason: 'GPU use is disabled in this process.',
    }))};
    const {candidates, reason} = await this.candidates(codec);
    const encoders = [];
    for(const id of ['amd', 'nvidia'] as const) {
      const candidate = candidates.find(candidate => candidate.vendor === id);
      encoders.push({id, label: candidate?.label || (id === 'amd' ? 'AMD GPU' : 'NVIDIA NVENC'), available: Boolean(candidate), encoder: candidate?.name,
        reason: candidate ? 'Encoder listed by FFmpeg. GPU and driver compatibility are checked only when an export is requested.'
          : reason || 'No encoder candidate found in the installed FFmpeg builds and device metadata.'});
    }
    return {codec, verification: 'not-run', encoders};
  }

  private async candidates(codec: ExportSettings['codec']): Promise<{candidates: HardwareEncoder[]; reason?: string}> {
    if(!['h264', 'h264-mkv', 'h265', 'av1'].includes(codec)) return {candidates: [], reason: 'Select H.264, H.265 or AV1 for GPU encoding.'};
    const family = codec === 'h265' ? 'hevc' : codec === 'h264-mkv' ? 'h264' : codec;
    const system = await resolveExecutable(ffmpegPath());
    const binaries = [...new Set([system, bundledRenderBinary('ffmpeg')].filter((value): value is string => Boolean(value)))];
    const devices: string[] = [];
    if(process.platform === 'linux') {
      for(const name of await readdir('/sys/class/drm').catch(() => [] as string[])) {
        if(!/^renderD\d+$/.test(name)) continue;
        const vendor = await readFile(path.join('/sys/class/drm', name, 'device/vendor'), 'utf8').catch(() => '');
        if(vendor.trim() === '0x1002') devices.push(path.join('/dev/dri', name));
      }
    }
    const candidates: HardwareEncoder[] = [];
    for(const binary of binaries) {
      const output = await runProcess(binary, ['-hide_banner', '-encoders'], 10000).catch(() => '');
      const names = new Set([...output.matchAll(/^\s*V\S*\s+(\S+)/gm)].map(match => match[1]));
      if(names.has(`${family}_nvenc`)) candidates.push({vendor: 'nvidia', backend: 'nvenc', name: `${family}_nvenc`, label: 'NVIDIA NVENC', binary});
      if(process.platform === 'linux' && names.has(`${family}_vaapi`)) for(const device of devices) candidates.push({vendor: 'amd', backend: 'vaapi', name: `${family}_vaapi`, label: 'AMD VA-API', binary, device});
      if(process.platform === 'win32' && names.has(`${family}_amf`)) candidates.push({vendor: 'amd', backend: 'amf', name: `${family}_amf`, label: 'AMD AMF', binary});
    }
    return {candidates};
  }

  private async detect(candidates: HardwareEncoder[], settings: ExportSettings, reason?: string): Promise<Detection> {
    let failure = reason || 'No compatible encoder/device found. Install the GPU driver and an FFmpeg build with GPU encoders; FFMPEG_PATH selects the binary.';
    for(const encoder of candidates) {
      try {
        // Encoder listings alone do not mean the installed GPU/driver can use it.
        // One synthetic frame checks the requested resolution, fps and rate control
        // before any timeline frames are rendered. No media or files are involved.
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}`,
          '-frames:v', '1', '-an', '-vf', 'zscale=matrix=709:matrixin=709:range=limited', '-c:v', 'libx264', '-f', 'null', '-'];
        await runProcess(encoder.binary, hardwareEncodingArguments(args, encoder, settings), 12000);
        return {encoder};
      } catch(error) {failure = (error as Error).message.slice(-450).trim();}
    }
    return {reason: failure};
  }
}
