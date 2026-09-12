import {bundle} from '@remotion/bundler';
import path from 'node:path';
import {type Project, type RenderJob} from '../../shared/project';
import {audioCodecsFor, extensionFor} from '../../shared/media-settings';
import {reframeProject} from '../../shared/project-settings';
import {browserExecutable} from './browser-service';
import {EncoderService} from './encoder-service';
import {hardwareEncodingArguments} from './encoding-arguments';
import {prepareRenderBinaries} from './render-binaries-service';
import {renderResources} from './render-resources-service';
import {exportFrameRange, layeredRenderPlan} from '../../shared/layered-render-plan';
import {renderLayeredVideo} from './layered-render-service';
import {remotionRenderer, routeHardwareEncoder} from './remotion-encoder-adapter';
import {openRenderBrowser} from './render-browser-service';

const {renderMedia, renderStill, selectComposition} = remotionRenderer;

export interface RenderTask {project: Project; job: RenderJob; workspace: string; root: string; exports: string; mediaBase: string}
export interface RenderProgress {progress: number; phase: string; detail?: string; encoder?: string; warning?: string}
export type RenderMessage = {type: 'ready'} | ({type: 'progress'} & RenderProgress) | {type: 'done'; file: string} | {type: 'error'; error: string};

/** Runs in a worker whose temporary directory is on the project's disk. */
export async function renderProject({project, job, workspace, root, exports, mediaBase}: RenderTask, onProgress: (progress: RenderProgress) => void) {
  const settings = job.settings;
  const renderProject = settings ? reframeProject(project, settings.fps) : project;
  const plan = job.kind === 'video' && settings ? layeredRenderPlan(renderProject, settings) : null;
  const resources = renderResources(settings?.width ?? project.width, settings?.height ?? project.height);
  onProgress({phase: 'Selecting encoder', progress: 0});
  const encoding = job.kind === 'video' && settings ? await new EncoderService().select(settings) : {label: 'PNG', encoder: undefined, warning: undefined};
  const hardware = encoding.encoder;
  onProgress({phase: 'Preparing composition', progress: 0, encoder: encoding.label, warning: encoding.warning});
  const file = `${job.id}.${settings ? extensionFor(settings.codec) : 'png'}`;
  const output = path.join(exports, file);
  const inputProps = {project: renderProject, mediaBase, ...(settings ? {output: {width: settings.width, height: settings.height, fit: settings.fit}} : {})};
  let renderer: Awaited<ReturnType<typeof openRenderBrowser>> | undefined;
  let serveUrl: string | undefined;
  const prepareComposition = async (overlay: boolean) => {
    // Plain native cuts never need a browser or a JavaScript bundle.
    serveUrl ??= await bundle({entryPoint: path.join(root, 'src/video/index.tsx'), outDir: path.join(workspace, 'bundle'), onProgress: value => onProgress({phase: 'Preparing composition', progress: value / 100 * .08})});
    renderer ??= await openRenderBrowser(hardware);
    const concurrency = renderer.accelerated ? Math.min(2, resources.concurrency) : resources.concurrency;
    onProgress({phase: 'Opening renderer', progress: .08, detail: renderer.label, warning: renderer.warning});
    const options = {serveUrl, inputProps: {...inputProps, ...(overlay && plan ? {overlayPass: {omitTrackId: plan.baseTrackId}} : {})}, browserExecutable: browserExecutable(),
      puppeteerInstance: renderer.browser, chromiumOptions: renderer.chromiumOptions,
      offthreadVideoCacheSizeInBytes: resources.offthreadVideoCacheSizeInBytes, offthreadVideoThreads: resources.offthreadVideoThreads};
    const composition = await selectComposition({...options, id: 'Project', timeoutInMilliseconds: 60000});
    return {...options, composition, concurrency, timeoutInMilliseconds: 60000};
  };
  try {
    if(plan && settings) {
      const completed = await renderLayeredVideo({plan, settings, workspace, output, hardware,
        render: () => prepareComposition(true), onProgress});
      if(completed) return file;
    }
    // Source metadata or effect requirements can disqualify the native path.
    // Select the complete composition; never silently drop unsupported effects.
    const {composition, concurrency, ...options} = await prepareComposition(false);
    const browserRenderer = renderer!;
    if(hardware) routeHardwareEncoder(await prepareRenderBinaries(workspace, hardware.binary), hardware.name);
    if(hardware) onProgress({phase: 'Preparing full composition', progress: .1, detail: browserRenderer.label,
      warning: `${browserRenderer.label}. This timeline requires frame-by-frame browser composition; source extraction, lossless frame transfer and audio still use CPU.`});
    const onDownload = () => {
      onProgress({phase: 'Loading footage', progress: .1});
      return ({percent, downloaded}: {percent: number | null; downloaded: number}) => onProgress({phase: 'Loading footage', progress: .1 + (percent ?? 0) * .1, detail: `${Math.round(downloaded / 1024 ** 2)} MB loaded`});
    };
    onProgress({phase: job.kind === 'frame' ? 'Rendering frame' : 'Loading footage', progress: .1});
    if(job.kind === 'frame') await renderStill({...options, composition, output, frame: job.frame, imageFormat: 'png', onDownload, timeoutInMilliseconds: 60000});
    else if(settings) await renderMedia({...options, composition, outputLocation: output, codec: settings.codec, onDownload, timeoutInMilliseconds: 60000,
      // Remotion defaults to JPEG 80 between Chromium and the encoder. That is a
      // second, lossy compression pass before CRF/CQ even applies, visible on HUDs.
      // Keep the artwork/source frames lossless until the final video encode.
      imageFormat: 'png',
      pixelFormat: settings.codec === 'prores' ? settings.proResProfile.startsWith('4444') ? 'yuv444p10le' : 'yuv422p10le' : 'yuv420p',
      ...(settings.codec === 'prores' ? {proResProfile: settings.proResProfile} : !hardware && settings.qualityMode === 'quality' ? {crf: settings.crf} : {videoBitrate: `${settings.videoBitrate}M`}),
      ...(!hardware && ['h264', 'h264-mkv'].includes(settings.codec) ? {x264Preset: settings.preset} : {}),
      ...(hardware ? {ffmpegOverride: ({args}: {args: string[]}) => hardwareEncodingArguments(args, hardware, settings)} : {}),
      muted: !settings.audio, audioCodec: settings.audio ? settings.audioCodec : audioCodecsFor(settings.codec)[0], ...(settings.audio && settings.audioCodec !== 'pcm-16' ? {audioBitrate: `${settings.audioBitrate}k`} : {}), sampleRate: settings.sampleRate,
      frameRange: exportFrameRange(renderProject, settings),
      concurrency, onProgress: ({progress, renderedFrames, encodedFrames, renderedDoneIn}) => onProgress({phase: renderedDoneIn === null ? 'Rendering video' : 'Encoding video', progress: .2 + progress * .79, detail: `${encoding.label} encoding · ${browserRenderer.accelerated ? 'GPU' : 'CPU'} browser composition · ${concurrency} workers · ${renderedFrames} frames rendered · ${encodedFrames} encoded`})});
    return file;
  } finally {await renderer?.browser.close({silent: true});}
}
