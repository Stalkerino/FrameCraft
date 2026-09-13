import {filterFileOption} from '../filter-file-service';
import {sourceLayers} from '../../../shared/native-sequence-plan';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {extensionFor} from '../../../shared/media-settings';
import {requireNativeScenePlan, type NativeVisualLayer} from '../../../shared/native-scene-plan';
import {mediaDir} from '../../config';
import {MediaFileRepository} from '../../repositories/media-file-repository';
import {ffprobePath, runProcess} from '../process-service';
import {runEncodingProcess} from '../ffmpeg-progress-service';
import {gpuDisabled} from './gpu-policy';
import {VulkanPipelineService} from './vulkan-pipeline-service';
import {vulkanVideoArguments, sceneAudioArguments, sceneAudioGraph} from './vulkan-scene-commands';
import {vulkanBatches, vulkanBatchGraph} from './vulkan-batch-service';
import {inspectNativeGpuSource, type NativeGpuSource} from './native-gpu-source';
import {nativeGpuMuxArguments} from './native-gpu-commands';
import {checkNativeVideoGeometry, publishNativeExport} from './native-export-files';
import type {RenderEngine, RenderProgress, RenderTask} from './engine-contract';
import {prepareNativeImage} from './native-image-service';
import {vulkanDiagnosticGuard} from './vulkan-diagnostics';
import {prepareGpuArtwork} from './gpu-artwork-service';
import {probeDuration} from '../probe-timing';

export const nativeVulkanEngine: RenderEngine = {id: 'native-vulkan', render: renderNativeScene};

async function renderNativeScene({project, job, workspace, exports}: RenderTask, onProgress: (value: RenderProgress) => void) {
  if(gpuDisabled()) throw new Error('GPU use is disabled in this process (FRAMECRAFT_DISABLE_GPU=1).');
  if(job.kind !== 'video' || !job.settings) throw new Error('Native Vulkan still export is not implemented yet.');
  const settings = job.settings;
  const plan = requireNativeScenePlan(project, settings);
  // Admit every group before opening a device, including late timeline spans.
  const batches = vulkanBatches(plan.spans, settings);
  onProgress({phase: 'Preparing GPU asset geometry', progress: 0, detail: 'Recipe compilation and font layout on CPU · vector drawing and animation on GPU'});
  const artwork = await prepareGpuArtwork(plan, settings.fps);
  const files = new MediaFileRepository(mediaDir);
  const visualSources = new Set(plan.spans.flatMap(span => sourceLayers(span).map(layer => layer.asset.id)));
  const sources = new Map<string, {file: string; info: NativeGpuSource}>();
  onProgress({phase: 'Reading native scene sources', progress: 0});
  for(const span of plan.spans) for(const segment of [...sourceLayers(span), ...span.audio]) {
    if((segment as NativeVisualLayer).artwork || (segment as NativeVisualLayer).textClip) continue;
    if(!sources.has(segment.asset.id)) {
      let file = files.resolve(segment.asset.src);
      let info: NativeGpuSource;
      if(segment.asset.kind === 'image') {
        onProgress({phase: 'Preparing static image textures', progress: .01, detail: 'One CPU image decode per source · GPU texture reused during rendering'});
        file = await prepareNativeImage(file, segment.asset, workspace, sources.size);
        info = {audio: false, duration: Infinity};
      } else if(visualSources.has(segment.asset.id)) info = await inspectNativeGpuSource(file, segment.asset, true);
      else {
        const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=codec_type,duration,duration_ts,time_base:format=duration', '-of', 'json', file], 15000));
        const audio = probe.streams?.find((stream: {codec_type: string}) => stream.codec_type === 'audio');
        info = {audio: !!audio, duration: probeDuration(audio, probe.format?.duration)};
        if((segment.asset.kind === 'audio' && !info.audio) || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error(`${segment.name}: audio duration could not be read.`);
      }
      sources.set(segment.asset.id, {file, info});
      onProgress({phase: 'Reading native scene sources', progress: .01, detail: `${sources.size} original sources read`});
    }
    const readFrames = ((segment as NativeVisualLayer).holdFrame || (segment as NativeVisualLayer).animation?.held) ? 1 : segment.duration;
    if(segment.asset.kind !== 'image' && segment.sourceStart + readFrames > Math.floor(sources.get(segment.asset.id)!.info.duration * settings.fps + 1e-7)) throw new Error(`${segment.name}: the requested range extends beyond the source.`);
  }
  onProgress({phase: 'Selecting Vulkan Video pipeline', progress: .02});
  const pipeline = await new VulkanPipelineService().select(settings);
  const directory = path.join(workspace, 'native-vulkan'); await mkdir(directory, {recursive: true});
  const videoLines = ['ffconcat version 1.0']; const audioLines = ['ffconcat version 1.0'];
  const label = `${pipeline.label} decode → Vulkan composition → Vulkan encode · 1 worker`;
  let completed = 0;
  onProgress({phase: 'Starting native Vulkan export', progress: .03, encoder: pipeline.label, detail: label});
  for(const [index, batch] of batches.entries()) {
    const part = `batch-${index}.nut`; const graphFile = path.join(directory, `batch-${index}.txt`);
    const compiled = vulkanBatchGraph(batch, settings, plan.background, artwork);
    await writeFile(graphFile, compiled.graph);
    onProgress({phase: 'Starting Vulkan batch', progress: .03 + .7 * completed / plan.frameCount,
      detail: `${label} · batch ${index + 1}/${batches.length} · ${batch.spans.length} scenes · estimate ${batch.estimatedMiB} MiB`});
    let frames = 0;
    try {
      await runEncodingProcess(pipeline.binary, vulkanVideoArguments(compiled.inputs, batch.duration, settings, compiled.inputs.map(layer => sources.get(layer.asset.id)!.file), graphFile, path.join(directory, part), pipeline, batch.bufferedFrames), {
        onDiagnostic: vulkanDiagnosticGuard(),
        onProgress: value => {
          frames = Math.max(frames, value.frame);
          onProgress({phase: 'Native Vulkan composition', progress: .03 + .7 * (completed + Math.min(frames, batch.duration)) / plan.frameCount,
            detail: `${label} · batch ${index + 1}/${batches.length} · ${frames}/${batch.duration} frames · estimate ${batch.estimatedMiB} MiB`});
        },
      });
      if(frames !== batch.duration) throw new Error(`Expected ${batch.duration} frames; received ${frames}.`);
      await checkNativeVideoGeometry(path.join(directory, part), settings);
    } catch(error) {
      throw new Error(`Native Vulkan stopped in batch at timeline frame ${batch.start} (${[...new Set(batch.spans.flatMap(span => span.layers.map(layer => layer.name)))].join(', ') || 'canvas background'}).\n${(error as Error).message}\nRequires Vulkan Video decode/encode support for these codecs on the selected ${pipeline.vendor.toUpperCase()} GPU. No alternate GPU, CPU/browser fallback or hardware retry was used.`, {cause: error});
    }
    videoLines.push(`file '${part}'`, `duration ${(batch.duration / settings.fps).toFixed(12)}`);
    completed += batch.duration;
  }
  // Original spans retain audio offsets/envelope boundaries, independently of
  // visual coalescing and GPU batch boundaries.
  completed = 0;
  if(settings.audio) {
    for(const [index, span] of plan.spans.entries()) {
      const audio = `audio-${index}.wav`;
      const samples = Math.round((completed + span.duration) / settings.fps * settings.sampleRate) - Math.round(completed / settings.fps * settings.sampleRate);
      const inputs = span.audio.filter(segment => sources.get(segment.asset.id)!.info.audio).map(segment => ({segment, file: sources.get(segment.asset.id)!.file}));
      const audioGraph = path.join(directory, `audio-${index}.txt`);
      await writeFile(audioGraph, sceneAudioGraph(inputs, settings, samples));
      await runEncodingProcess(pipeline.binary, sceneAudioArguments(inputs, settings, audioGraph, path.join(directory, audio), await filterFileOption(pipeline.binary)), {
        onProgress: value => onProgress({phase: 'Mixing native timeline audio', progress: .73 + .15 * (completed + span.duration) / plan.frameCount,
          detail: `${inputs.length} audio sources · CPU audio only · ${(value.outTimeUs / 1e6).toFixed(1)} s`}),
      });
      audioLines.push(`file '${audio}'`);
      completed += span.duration;
    }
  }
  const videoList = path.join(directory, 'video.ffconcat'); const audioList = path.join(directory, 'audio.ffconcat');
  await writeFile(videoList, videoLines.join('\n') + '\n');
  if(settings.audio) await writeFile(audioList, audioLines.join('\n') + '\n');
  const filename = `${job.id}.${extensionFor(settings.codec)}`; const output = path.join(directory, filename);
  await runEncodingProcess(pipeline.binary, nativeGpuMuxArguments(videoList, settings.audio ? audioList : undefined, output, settings), {
    onProgress: value => onProgress({phase: 'Writing native Vulkan export', progress: .88 + .1 * Math.min(1, value.outTimeUs / 1e6 * settings.fps / plan.frameCount), detail: 'Copying encoded video packets · audio encoding and container writing on CPU'}),
  });
  await publishNativeExport(output, exports, filename);
  onProgress({phase: 'Native Vulkan export complete', progress: .99, detail: `${label} · ${plan.frameCount} frames`});
  return filename;
}
