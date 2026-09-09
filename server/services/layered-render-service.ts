import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {renderFrames, type RenderFramesOptions} from '@remotion/renderer';
import {overlayRunsForSegment, type LayeredRenderPlan, type VideoSegment} from '../../shared/layered-render-plan';
import type {ExportSettings} from '../../shared/media-settings';
import {audioVolumeFilter} from '../../shared/audio-envelope';
import {hardwareEncodingArguments, type HardwareEncoder} from './encoding-arguments';
import {bundledRenderBinary, resolveExecutable} from './render-binaries-service';
import {ffmpegPath, ffprobePath, runProcess} from './process-service';
import {MediaFileRepository} from '../repositories/media-file-repository';
import {mediaDir} from '../config';
import type {RenderProgress} from './render-engine';
import {filterFrameBudget} from './render-resources-service';
import {EncodingStalledError, runEncodingProcess} from './ffmpeg-progress-service';
import {normalizeArtworkFrames} from './artwork-image-service';
import {isNeutralColorGrade} from '../../shared/color-grading';
import {ColorGradeLutService} from './color-grade-lut-service';

interface SourceInfo {audio: boolean; pixelFormat: string; width: number; height: number; rotation: number; sar: string}
interface HardwareDecoder {input: string[]; filter: string}
interface LayeredOptions {
  plan: LayeredRenderPlan; settings: ExportSettings; workspace: string; output: string; hardware?: HardwareEncoder;
  render: Omit<RenderFramesOptions, 'onStart' | 'onFrameUpdate' | 'outputDir'>;
  onProgress: (value: RenderProgress) => void;
}

/** Sequential source decoding + shared React artwork + one final video encode. */
export async function renderLayeredVideo({plan, settings, workspace, output, hardware, render, onProgress}: LayeredOptions) {
  const directory = path.join(workspace, 'layered'); await mkdir(directory, {recursive: true});
  const files = new MediaFileRepository(mediaDir);
  const binary = hardware?.binary || await resolveExecutable(ffmpegPath());
  if(!binary) return false;
  // Remotion's reduced FFmpeg build may omit native video composition filters.
  const filterList = await runProcess(binary, ['-hide_banner', '-filters'], 10000).catch(() => '');
  const filters = new Set(filterList.split('\n').map(line => line.trim().split(/\s+/)[1]));
  if(['fps', 'scale', 'setsar', 'tpad', 'trim', 'setpts', 'format', 'overlay', 'zscale', 'asetpts', 'aresample', 'volume', 'apad', 'atrim', 'anullsrc'].some(filter => !filters.has(filter))) return false;
  if(plan.segments.some(segment => !isNeutralColorGrade(segment.colorGrade) || !isNeutralColorGrade(segment.projectColorGrade) || (segment.opacity ?? 1) !== 1) && (!filters.has('lut3d') || !filters.has('lutrgb'))) return false;
  const grading = new ColorGradeLutService(directory);
  // Older FFmpeg builds (including Windows installs) lack this safety option.
  const help = await runProcess(binary, ['-hide_banner', '-h', 'long'], 10000).catch(() => '');
  const canLimitBuffers = help.includes('-filter_buffered_frames');
  const sources = new Map<string, {file: string; info: SourceInfo; decoder?: HardwareDecoder}>();
  for(const segment of plan.segments) {
    if(sources.has(segment.asset.id)) continue;
    const file = files.resolve(segment.asset.src);
    const info = await inspectSource(file);
    // Rotated, HDR and anamorphic footage needs the full renderer's conversion.
    if(info.rotation || !['', '0:1', '1:1'].includes(info.sar) || !['yuv420p', 'yuvj420p', 'nv12'].includes(info.pixelFormat) || info.width !== segment.asset.width || info.height !== segment.asset.height) return false;
    onProgress({phase: 'Preparing video decoding', progress: .09, detail: segment.asset.name});
    const decoder = hardware ? await selectHardwareDecoder(binary, hardware, file, segment.sourceStart / settings.fps) : undefined;
    sources.set(segment.asset.id, {file, info, decoder});
  }
  const total = plan.lastFrame - plan.firstFrame + 1;
  const label = hardware?.label || 'CPU';
  let pattern: string | undefined;
  if(plan.overlayFrames.length) {
    const frames = await renderFrames({...render, imageFormat: 'png', muted: true, outputDir: path.join(directory, 'overlays'), frames: plan.overlayFrames,
      onStart: () => onProgress({phase: 'Rendering artwork', progress: .1, detail: `${plan.overlayFrames.length} unique artwork frames for ${total} video frames`}),
      onFrameUpdate: count => onProgress({phase: 'Rendering artwork', progress: .1 + count / plan.overlayFrames.length * .35, detail: `${count} / ${plan.overlayFrames.length} artwork frames · repeated images reused`})});
    pattern = frames.assetsInfo.imageSequenceName;
    // Chromium may omit alpha on fully opaque PNGs. Mixing those RGB images
    // with RGBA frames reinitializes FFmpeg's graph at fades and can strand
    // queued audio/video at a cut boundary. Keep the entire input RGBA.
    await normalizeArtworkFrames(pattern, plan.overlayFrames, (completed, count) => {
      if(completed === count || completed % 50 === 0) onProgress({phase: 'Preparing artwork', progress: .45,
        detail: `${completed} / ${count} artwork frames ready`});
    });
  }
  const parts: string[] = []; let encoded = 0;
  for(const [index, segment] of plan.segments.entries()) {
    const part = path.join(directory, `part-${index}.nut`); parts.push(part);
    let overlay: string | undefined;
    if(pattern) {
      overlay = path.join(directory, `overlay-${index}.ffconcat`);
      const lines = ['ffconcat version 1.0'];
      const runs = overlayRunsForSegment(plan, segment);
      const frameName = (frame: number) => path.relative(directory, pattern!.replace(/%0(\d+)d/, (_match, digits) => String(frame).padStart(Number(digits), '0'))).split(path.sep).join('/');
      for(const run of runs) lines.push(`file '${frameName(run.frame)}'`, `option framerate ${settings.fps}`, `duration ${(run.duration / settings.fps).toFixed(12)}`);
      // Concat image durations require a terminal image; the output frame count
      // removes that sentinel, including for fractional frame rates.
      lines.push(`file '${frameName(runs.at(-1)!.frame)}'`, `option framerate ${settings.fps}`);
      await writeFile(overlay, lines.join('\n') + '\n');
    }
    const source = sources.get(segment.asset.id)!;
    const colorFilter = await grading.ensure(segment.colorGrade, segment.projectColorGrade, segment.opacity, segment.backgroundColor);
    const audioSamples = Math.round((encoded + segment.duration) / settings.fps * settings.sampleRate) - Math.round(encoded / settings.fps * settings.sampleRate);
    const maxBufferedFrames = canLimitBuffers ? filterFrameBudget(Math.max(settings.width, source.info.width), Math.max(settings.height, source.info.height)) : undefined;
    const encode = async () => {
      const args = segmentArguments({segment, settings, source: source.file, hasAudio: source.info.audio, decoder: source.decoder, overlay, output: part, audioSamples, maxBufferedFrames, colorFilter});
      const finalArgs = hardware ? hardwareEncodingArguments(args, hardware, settings) : args;
      const decoding = source.decoder ? 'GPU decoding' : 'CPU decoding';
      onProgress({phase: 'Encoding video', progress: .45 + encoded / total * .5, detail: `${label} · ${decoding} · clip ${index + 1} / ${plan.segments.length}`});
      await runEncodingProcess(binary, finalArgs, {onProgress: value => {
        const frames = Math.max(0, Math.min(segment.duration, value.frame));
        onProgress({phase: 'Encoding video', progress: .45 + (encoded + frames) / total * .5, detail: `${label} · ${decoding} · clip ${index + 1} / ${plan.segments.length} · ${encoded + frames} / ${total} frames encoded · ${(value.totalSize / 1024 ** 2).toFixed(2)} MB written`});
      }});
    };
    try {await encode();}
    catch(error) {
      if(!(error instanceof EncodingStalledError) || !source.decoder) throw error;
      // A one-frame capability probe cannot rule out a decoder hanging at a
      // later seek or EOF. Retry only this unfinished part, after the child has
      // closed; retain the selected GPU encoder and every completed cut.
      source.decoder = undefined;
      onProgress({phase: 'Recovering video decoding', progress: .45 + encoded / total * .5,
        detail: `Retrying clip ${index + 1} / ${plan.segments.length}`,
        warning: `Encoding stopped progressing. Retrying this cut with CPU decoding and ${label} encoding.`});
      await encode();
    }
    encoded += segment.duration;
  }
  const playlist = path.join(directory, 'video.ffconcat');
  await writeFile(playlist, ['ffconcat version 1.0', ...parts.flatMap((part, index) => [`file '${path.basename(part)}'`, `duration ${(plan.segments[index].duration / settings.fps).toFixed(12)}`])].join('\n') + '\n');
  onProgress({phase: 'Finalizing video', progress: .96, detail: 'Joining clips and audio · video copied without re-encoding'});
  await runProcess(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', playlist,
    '-map', '0:v:0', '-c:v', 'copy', ...(settings.audio ? ['-map', '0:a:0', '-c:a', settings.audioCodec === 'pcm-16' ? 'pcm_s16le' : settings.audioCodec,
      ...(settings.audioCodec === 'pcm-16' ? [] : ['-b:a', `${settings.audioBitrate}k`]), '-ar', String(settings.sampleRate)] : ['-an']),
    ...(settings.codec === 'h264-mkv' ? [] : ['-movflags', '+faststart', '-video_track_timescale', '90000']), '-t', String(total / settings.fps), '-y', output], 24 * 60 * 60_000);
  return true;
}

export function segmentArguments({segment, settings, source, hasAudio, overlay, output, audioSamples, decoder, maxBufferedFrames, colorFilter}: {
  segment: VideoSegment; settings: ExportSettings; source: string; hasAudio: boolean; overlay?: string; output: string; audioSamples: number; decoder?: HardwareDecoder; maxBufferedFrames?: number; colorFilter?: string;
}): string[] {
  const duration = segment.duration / settings.fps;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(maxBufferedFrames ? ['-filter_buffered_frames', String(maxBufferedFrames)] : []),
    '-threads', '4', ...(decoder?.input || []), '-ss', String(segment.sourceStart / settings.fps), '-t', String(duration), '-i', source];
  let nextInput = 1;
  if(overlay) {args.push('-threads:v', '1', '-f', 'concat', '-safe', '0', '-i', overlay); nextInput++;}
  const audioInput = hasAudio && segment.volume > 0 ? '0:a:0' : `${nextInput}:a:0`;
  if(settings.audio && (!hasAudio || segment.volume === 0)) args.push('-f', 'lavfi', '-i', `anullsrc=r=${settings.sampleRate}:cl=stereo`);
  const baseFilter = `${decoder ? decoder.filter + ',' : ''}setpts=PTS-STARTPTS,fps=${settings.fps}:start_time=0,scale=${settings.width}:${settings.height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${segment.duration},setpts=N/(${settings.fps}*TB)`;
  const filters = [`[0:v:0]${baseFilter}${colorFilter ? `,${colorFilter}` : ''}[base]`];
  // Keep artwork sparse. Expanding long holds with fps creates an independently
  // advancing input and can queue gigabytes of base frames waiting for artwork.
  // Overlay framesync holds the latest PNG until its next timestamp; the base
  // already supplies exactly one output frame per project frame.
  if(overlay) filters.push('[1:v:0]setpts=PTS-STARTPTS,format=rgba[art]', '[base][art]overlay=0:0:format=auto:alpha=straight:repeatlast=1[composed]');
  else filters.push('[base]null[composed]');
  filters.push('[composed]zscale=matrix=709:matrixin=709:range=limited[video]');
  if(settings.audio) filters.push(`[${audioInput}]asetpts=PTS-STARTPTS,aresample=${settings.sampleRate},${audioVolumeFilter(segment.audioEnvelope, settings.fps, segment.volume)},apad=whole_len=${audioSamples},atrim=end_sample=${audioSamples}[audio]`);
  args.push('-filter_complex_threads', '2', '-filter_complex', filters.join(';'), '-map', '[video]', '-r', String(settings.fps));
  if(settings.audio) args.push('-map', '[audio]', '-c:a', 'pcm_s16le', '-ac', '2', '-ar', String(settings.sampleRate));
  else args.push('-an');
  // hardwareEncodingArguments replaces only these output encoding options.
  const codec = settings.codec === 'h265' ? 'libx265' : settings.codec === 'av1' ? 'libaom-av1' : 'libx264';
  args.push('-c:v', codec, '-threads:v', '4', '-pix_fmt', 'yuv420p',
    ...(settings.qualityMode === 'quality' ? ['-crf', String(settings.crf)] : ['-b:v', `${settings.videoBitrate}M`]),
    ...(codec === 'libx264' ? ['-preset', settings.preset] : []), '-g', String(Math.max(1, Math.round(settings.fps * 2))),
    '-colorspace:v', 'bt709', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-color_range', 'tv',
    // A timestamp limit alone can leave delayed GPU packets waiting for the
    // sparse artwork/audio graph to finish. Explicitly end video at the exact
    // frame count so the encoder flushes; audio retains its own sample bound.
    '-frames:v', String(segment.duration), '-t', String(duration), '-progress', 'pipe:1', '-nostats', '-f', 'nut', '-y', output);
  return args;
}

async function selectHardwareDecoder(binary: string, encoder: HardwareEncoder, file: string, time: number): Promise<HardwareDecoder | undefined> {
  const type = encoder.backend === 'nvenc' ? 'cuda' : encoder.backend === 'vaapi' ? 'vaapi' : 'd3d11va';
  const format = type === 'd3d11va' ? 'd3d11' : type;
  const decoder = {input: ['-hwaccel', type, '-hwaccel_output_format', format, ...(encoder.device ? ['-hwaccel_device', encoder.device] : [])], filter: 'hwdownload,format=nv12'};
  try {
    // Probe the actual codec/profile at the cut's source position. An unsupported
    // decoder falls back to continuous CPU decoding while retaining GPU encoding.
    await runProcess(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...decoder.input, '-ss', String(time), '-i', file,
      '-frames:v', '1', '-an', '-vf', decoder.filter, '-f', 'null', '-'], 10000);
    return decoder;
  } catch {return undefined;}
}

async function inspectSource(file: string): Promise<SourceInfo> {
  const args = ['-v', 'error', '-show_streams', '-of', 'json', file];
  const text = await runProcess(ffprobePath(), args, 15000).catch(() => runProcess(bundledRenderBinary('ffprobe'), args, 15000));
  const {streams} = JSON.parse(text) as {streams: {codec_type: string; pix_fmt?: string; width?: number; height?: number; sample_aspect_ratio?: string; side_data_list?: {rotation?: number}[]; tags?: {rotate?: string}}[]};
  const video = streams.find(stream => stream.codec_type === 'video');
  return {audio: streams.some(stream => stream.codec_type === 'audio'), pixelFormat: video?.pix_fmt || '', width: video?.width || 0, height: video?.height || 0,
    rotation: Number(video?.tags?.rotate || video?.side_data_list?.find(data => data.rotation)?.rotation || 0), sar: video?.sample_aspect_ratio || ''};
}
