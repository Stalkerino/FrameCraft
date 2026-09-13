import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {extensionFor} from '../../../shared/media-settings';
import {requireNativeGpuPlan} from '../../../shared/native-gpu-plan';
import {mediaDir} from '../../config';
import {MediaFileRepository} from '../../repositories/media-file-repository';
import {EncoderService} from '../encoder-service';
import {runEncodingProcess} from '../ffmpeg-progress-service';
import {gpuDisabled} from './gpu-policy';
import type {RenderEngine, RenderProgress, RenderTask} from './engine-contract';
import {selectNativeGpuAdapter} from './native-gpu-adapters';
import {nativeGpuAudioArguments, nativeGpuMuxArguments, nativeGpuVideoArguments} from './native-gpu-commands';
import {inspectNativeGpuSource, type NativeGpuSource} from './native-gpu-source';
import {checkNativeVideoGeometry, publishNativeExport} from './native-export-files';

export const nativeGpuEngine: RenderEngine = {id: 'native-gpu', render: renderNativeGpu};

async function renderNativeGpu({project, job, workspace, exports}: RenderTask, onProgress: (progress: RenderProgress) => void) {
  if(job.kind !== 'video' || !job.settings) throw new Error('Native GPU still-image export is not implemented yet.');
  if(gpuDisabled()) throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
  const settings = job.settings;
  const plan = requireNativeGpuPlan(project, settings);
  const directory = path.join(workspace, 'native-gpu');
  await mkdir(directory, {recursive: true});
  const files = new MediaFileRepository(mediaDir);
  const sources = new Map<string, {file: string; info: NativeGpuSource}>();
  onProgress({phase: 'Reading source metadata', progress: 0});
  for(const segment of plan.segments) {
    if(!sources.has(segment.asset.id)) {
      const file = files.resolve(segment.asset.src); // Always original media, never a preview proxy.
      sources.set(segment.asset.id, {file, info: await inspectNativeGpuSource(file, segment.asset)});
      onProgress({phase: 'Reading source metadata', progress: .01, detail: `${sources.size} video sources read`});
    }
    const source = sources.get(segment.asset.id)!;
    if(segment.sourceStart + segment.duration > Math.floor(source.info.duration * settings.fps + 1e-7)) throw new Error(`${segment.name}: the source ends before the requested cut. No CPU frame hold was used.`);
  }
  onProgress({phase: 'Selecting native GPU adapter', progress: .02});
  const {encoder, adapter} = await selectNativeGpuAdapter(await new EncoderService().nativeCandidates(settings));
  const videoLines = ['ffconcat version 1.0']; const audioLines = ['ffconcat version 1.0'];
  let completed = 0;
  const pipeline = `${adapter.label} · GPU-resident video · 1 worker`;
  onProgress({phase: 'Starting native GPU export', progress: .03, encoder: encoder.label, detail: pipeline});
  for(const [index, segment] of plan.segments.entries()) {
    const source = sources.get(segment.asset.id)!;
    const part = `video-${index}.nut`;
    let frames = 0;
    try {
      await runEncodingProcess(encoder.binary, nativeGpuVideoArguments(segment, settings, source.file, path.join(directory, part), encoder, adapter), {
        onProgress: value => {
          frames = Math.max(frames, value.frame);
          onProgress({phase: 'Native GPU video', progress: .03 + .85 * (completed + Math.min(segment.duration, frames)) / plan.frameCount,
            detail: `${pipeline} · cut ${index + 1}/${plan.segments.length} · ${frames}/${segment.duration} frames`});
        },
      });
      if(frames !== segment.duration) throw new Error(`Expected ${segment.duration} frames; the encoder produced ${frames}.`);
      // Headers only: no count_frames/decoding or GPU-to-CPU image readback.
      await checkNativeVideoGeometry(path.join(directory, part), settings);
    } catch(error) {
      // No synthetic probes, retry, CPU decode, software filters or browser fallback.
      throw new Error(`Native GPU export stopped on ${segment.name} (${adapter.id}: ${adapter.label}).\n${(error as Error).message}\nNo CPU/browser fallback was used.`, {cause: error});
    }
    videoLines.push(`file '${part}'`, `duration ${(segment.duration / settings.fps).toFixed(12)}`);
    if(settings.audio) {
      const audio = `audio-${index}.wav`;
      const samples = Math.round((completed + segment.duration) / settings.fps * settings.sampleRate) - Math.round(completed / settings.fps * settings.sampleRate);
      await runEncodingProcess(encoder.binary, nativeGpuAudioArguments(segment, settings, source.file, path.join(directory, audio), source.info.audio, samples), {
        onProgress: value => onProgress({phase: 'Preparing audio', progress: .03 + .85 * (completed + segment.duration) / plan.frameCount,
          detail: `Audio on CPU · cut ${index + 1}/${plan.segments.length} · ${(value.outTimeUs / 1e6).toFixed(1)} s`}),
      });
      // WAV lengths are exact sample counts, including rounding across cut boundaries.
      audioLines.push(`file '${audio}'`);
    }
    completed += segment.duration;
  }
  const videoList = path.join(directory, 'video.ffconcat'); const audioList = path.join(directory, 'audio.ffconcat');
  await writeFile(videoList, videoLines.join('\n') + '\n');
  if(settings.audio) await writeFile(audioList, audioLines.join('\n') + '\n');
  const filename = `${job.id}.${extensionFor(settings.codec)}`;
  const output = path.join(directory, filename);
  await runEncodingProcess(encoder.binary, nativeGpuMuxArguments(videoList, settings.audio ? audioList : undefined, output, settings), {
    onProgress: value => onProgress({phase: 'Writing export', progress: .88 + .1 * Math.min(1, value.outTimeUs / 1e6 * settings.fps / plan.frameCount),
      detail: 'Copying encoded video packets · audio encoding and container writing on CPU'}),
  });
  // Only completed output enters the exports directory. These operations also
  // work when the render cache is on a different disk on Windows or Linux.
  await publishNativeExport(output, exports, filename);
  onProgress({phase: 'Native GPU export complete', progress: .99, detail: `${pipeline} · ${plan.frameCount} frames`});
  return filename;
}
