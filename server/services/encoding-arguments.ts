import type {ExportSettings} from '../../shared/media-settings';
import type {EncodingBackend, GpuVendor} from '../../shared/encoding';

export interface HardwareEncoder {
  vendor: GpuVendor;
  backend: EncodingBackend;
  name: string;
  label: string;
  binary: string;
  device?: string;
}

/** Changes the encoding step only. Remotion's final audio mux keeps -c:v copy. */
export function hardwareEncodingArguments(args: string[], encoder: HardwareEncoder, settings: ExportSettings, hardwareFrames = false) {
  const codecIndex = args.indexOf('-c:v');
  if(codecIndex < 0 || args[codecIndex + 1] === 'copy') return args;
  const result: string[] = [];
  let filter = '';
  const replaced = new Set(['-crf', '-preset', '-b:v', '-q:v', '-pix_fmt', '-cpu-used', '-deadline', '-row-mt']);
  for(let i = 0; i < args.length; i++) {
    if(args[i] === '-vf') {filter = args[++i]; continue;}
    if(args[i] === '-c:v') {result.push('-c:v', encoder.name); i++; continue;}
    if(replaced.has(args[i])) {i++; continue;}
    result.push(args[i]);
  }
  const quality = settings.qualityMode === 'quality';
  const q = String(Math.min(51, settings.crf));
  const bitrate = `${settings.videoBitrate}M`;
  const extra: string[] = [];
  if(encoder.backend === 'vaapi') {
    result.unshift('-vaapi_device', encoder.device!);
    if(!hardwareFrames) filter = [filter, 'format=nv12', 'hwupload'].filter(Boolean).join(',');
    extra.push(...(quality ? ['-rc_mode', 'CQP', '-qp', settings.codec === 'av1' ? String(Math.round(settings.crf / 63 * 255)) : q] : ['-rc_mode', 'VBR', '-b:v', bitrate]));
  } else if(encoder.backend === 'amf') {
    const speed = ['ultrafast', 'veryfast'].includes(settings.preset) ? 'speed' : ['slow', 'veryslow'].includes(settings.preset) ? 'quality' : 'balanced';
    extra.push(...(hardwareFrames ? [] : ['-pix_fmt', 'nv12']), '-quality', speed, ...(
      quality ? ['-rc', 'cqp', '-qp_i', settings.codec === 'av1' ? String(Math.max(1, Math.round(settings.crf / 63 * 255))) : q,
        '-qp_p', settings.codec === 'av1' ? String(Math.max(1, Math.round(settings.crf / 63 * 255))) : q]
        : ['-rc', 'vbr_peak', '-b:v', bitrate, '-maxrate', `${settings.videoBitrate * 1.5}M`]
    ));
  } else {
    const speed = {ultrafast: 'p1', veryfast: 'p2', fast: 'p3', medium: 'p4', slow: 'p6', veryslow: 'p7'}[settings.preset];
    extra.push(...(hardwareFrames ? [] : ['-pix_fmt', 'yuv420p']), '-preset', speed, '-rc', 'vbr', ...(
      quality ? ['-cq', q, '-b:v', '0'] : ['-b:v', bitrate]
    ));
  }
  if(filter) {
    const graphIndex = result.indexOf('-filter_complex');
    const mapIndex = result.indexOf('-map');
    const videoLabel = result[mapIndex + 1];
    if(graphIndex >= 0 && mapIndex >= 0 && /^\[\w+\]$/.test(videoLabel)) {
      // Native composition already has a video graph; append the upload there.
      // FFmpeg forbids -vf and -filter_complex on the same output stream.
      result[graphIndex + 1] += `;${videoLabel}${filter}[framecraft_encoded]`;
      result[mapIndex + 1] = '[framecraft_encoded]';
    } else extra.push('-vf', filter);
  }
  // The last argument is always the output filename (or '-' during detection).
  result.splice(result.length - 1, 0, ...extra);
  return result;
}
