import type {ExportSettings} from '../../../shared/media-settings';
import type {NativeGpuSegment} from '../../../shared/native-gpu-plan';
import {audioVolumeFilter} from '../../../shared/audio-envelope';
import {hardwareEncodingArguments, type HardwareEncoder} from '../encoding-arguments';
import type {NativeGpuAdapter} from './native-gpu-adapters';

export function nativeGpuVideoArguments(segment: NativeGpuSegment, settings: ExportSettings, file: string, output: string, encoder: HardwareEncoder, adapter: NativeGpuAdapter) {
  // format here is a hardware-format constraint, NOT pixel conversion. Even
  // FFmpeg builds which silently fall back to software decoding must fail it.
  // No hwupload, hwdownload, auto scale, browser or software encoder is allowed.
  const video = [`format=pix_fmts=${adapter.inputFormat}`, 'setpts=PTS-STARTPTS', adapter.scale(settings),
    `fps=fps=${settings.fps}:start_time=0`, `trim=end_frame=${segment.duration}`, `setpts=N/(${settings.fps}*TB)`, 'setsar=1'].join(',');
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-noauto_conversion_filters', ...adapter.initialize,
    '-hwaccel', adapter.decoder, '-hwaccel_device', 'fc', '-hwaccel_output_format', adapter.inputFormat,
    '-extra_hw_frames', '4', '-threads', '2', '-noautorotate', '-ss', String(segment.sourceStart / settings.fps), '-i', file,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-filter_threads', '1', '-vf', video,
    '-c:v', encoder.name, '-r', String(settings.fps), '-bf', '0', '-g', String(Math.max(1, Math.round(settings.fps * 2))),
    '-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range:v', 'tv',
    '-frames:v', String(segment.duration), '-progress', 'pipe:1', '-nostats', '-f', 'nut', '-y', output];
  const configured = hardwareEncodingArguments(args, encoder, settings, true, {initializeDevice: false});
  // '+' rejects an unsupported encoder pixel format instead of selecting a
  // software format. Rate-control adaptation intentionally runs before this.
  configured.splice(configured.length - 1, 0, '-pix_fmt', `+${adapter.outputFormat}`, ...adapter.encoderOptions);
  return configured;
}

/** Audio is a separate CPU job with video disabled, so its conversion filters
 * cannot negotiate or download the native video graph's GPU surfaces.
 */
export function nativeGpuAudioArguments(segment: NativeGpuSegment, settings: ExportSettings, file: string, output: string, hasAudio: boolean, sampleCount: number) {
  const input = hasAudio && segment.volume > 0
    ? ['-ss', String(segment.sourceStart / settings.fps), '-t', String(segment.duration / settings.fps), '-i', file]
    : ['-f', 'lavfi', '-i', `anullsrc=r=${settings.sampleRate}:cl=stereo`];
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', ...input, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-filter_threads', '1', '-af', `asetpts=PTS-STARTPTS,aresample=${settings.sampleRate},${audioVolumeFilter(segment.audioEnvelope, settings.fps, segment.volume)},apad=whole_len=${sampleCount},atrim=end_sample=${sampleCount}`,
    '-ac', '2', '-ar', String(settings.sampleRate), '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', '-y', output];
}

export function nativeGpuMuxArguments(videoList: string, audioList: string | undefined, output: string, settings: ExportSettings) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'concat', '-safe', '1', '-i', videoList];
  if(audioList) args.push('-f', 'concat', '-safe', '1', '-i', audioList);
  args.push('-map', '0:v:0', '-c:v', 'copy');
  if(audioList) args.push('-map', '1:a:0', '-c:a', settings.audioCodec === 'pcm-16' ? 'pcm_s16le' : 'aac',
    ...(settings.audioCodec === 'pcm-16' ? [] : ['-b:a', `${settings.audioBitrate}k`]), '-ar', String(settings.sampleRate), '-ac', '2');
  else args.push('-an');
  if(settings.codec !== 'h264-mkv') args.push('-movflags', '+faststart');
  if(settings.codec === 'h265') args.push('-tag:v', 'hvc1');
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}
