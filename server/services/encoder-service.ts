import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {exportSettingsSchema, type ExportSettings} from '../../shared/media-settings';
import type {EncoderCapabilities, GpuVendor} from '../../shared/encoding';
import {ffmpegPath, runProcess} from './process-service';
import {bundledRenderBinary, resolveExecutable} from './render-binaries-service';
import {hardwareEncodingArguments, type HardwareEncoder} from './encoding-arguments';

interface Detection {encoder?: HardwareEncoder; reason?: string}

export class EncoderService {
  private capabilitiesCache = new Map<string, {expires: number; value: Promise<EncoderCapabilities>}>();

  capabilities(codec: ExportSettings['codec']) {
    const cached = this.capabilitiesCache.get(codec);
    if(cached && cached.expires > Date.now()) return cached.value;
    const value = this.inspect(codec);
    this.capabilitiesCache.set(codec, {expires: Date.now() + 60000, value});
    void value.catch(() => this.capabilitiesCache.delete(codec));
    return value;
  }

  async select(settings: ExportSettings): Promise<{encoder?: HardwareEncoder; label: string; warning?: string}> {
    if(settings.encoder === 'cpu') return {label: 'CPU'};
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
    const {candidates, reason} = await this.candidates(codec);
    const settings = exportSettingsSchema.parse({width: 128, height: 128, fps: 30, codec, audio: false});
    const encoders = [];
    for(const id of ['amd', 'nvidia'] as const) {
      const detected = await this.detect(candidates.filter(candidate => candidate.vendor === id), settings, reason);
      encoders.push({id, label: detected.encoder?.label || (id === 'amd' ? 'AMD GPU' : 'NVIDIA NVENC'), available: Boolean(detected.encoder), encoder: detected.encoder?.name, reason: detected.reason});
    }
    return {codec, encoders};
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
