import {sceneLayers, sourceLayers} from './native-sequence-plan';
import {z} from 'zod';
import {durationOf, type Project} from './project';
import {defaultExportSettings, exportSettingsSchema} from './media-settings';
import {reframeProject} from './project-settings';
import {layeredRenderEligibility, type RenderBlocker} from './render-eligibility';
import {isNeutralColorGrade} from './color-grading';
import {clipTrackId, projectTracks} from './tracks';
import {nativeGpuPlan} from './native-gpu-plan';
import {nativeScenePlan} from './native-scene-plan';

export const renderPlanRequestSchema = z.object({sequenceId: z.string().min(1).max(100).optional(), revision: z.number().int().nonnegative().optional(), settings: exportSettingsSchema.optional()});
export type RenderPlanRequest = z.infer<typeof renderPlanRequestSchema>;
export interface RenderStagePlan {
  id: 'decode' | 'processing' | 'artwork' | 'asset-preparation' | 'transfer' | 'encode' | 'audio';
  label: string;
  execution: 'cpu' | 'conditional' | 'browser' | 'none' | 'gpu-required';
  description: string;
}
export interface RenderPlan {
  projectId: string;
  revision: number;
  engine: 'remotion-compatibility' | 'native-gpu' | 'native-vulkan';
  route: 'browser-composition' | 'native-video' | 'native-video-with-artwork' | 'native-gpu' | 'native-vulkan' | 'unsupported';
  verification: 'not-run';
  summary: string;
  stages: RenderStagePlan[];
  blockers: RenderBlocker[];
  notes: string[];
}

/** Cheap structural planning: never decode media, enumerate frames or initialize a GPU. */
export function describeRenderPlan(original: Project, input: RenderPlanRequest = {}): RenderPlan {
  const settings = exportSettingsSchema.parse(input.settings ?? defaultExportSettings(original));
  if(settings.renderer !== 'compatible') return describeNativeGpuPlan(original, settings);
  const project = reframeProject(original, settings.fps);
  const duration = durationOf(project) / project.fps;
  if(settings.startSeconds >= duration || (settings.endSeconds ?? 0) > duration + .000001) throw new Error('Export range must be inside the timeline.');
  const eligibility = layeredRenderEligibility(project, settings);
  const browser = eligibility.blockers.length > 0;
  const visible = new Set(projectTracks(project).filter(track => !track.hidden).map(track => track.id));
  const first = Math.floor(settings.startSeconds * settings.fps);
  const last = Math.ceil((settings.endSeconds ?? duration) * settings.fps);
  const clips = project.clips.filter(clip => visible.has(clipTrackId(project, clip)) && clip.start < last && clip.start + clip.duration > first);
  const artwork = clips.some(clip => clip.kind !== 'video' && clip.kind !== 'audio');
  const footage = clips.some(clip => clip.kind === 'video');
  const softwareEncoding = settings.encoder === 'cpu' || !['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec);
  const cpuGrading = !isNeutralColorGrade(project.colorGrade) || clips.some(clip => clip.kind === 'video'
    && (!isNeutralColorGrade(clip.colorGrade) || (clip.opacity ?? 1) !== 1));
  const route = browser ? 'browser-composition' : artwork ? 'native-video-with-artwork' : 'native-video';
  return {
    projectId: original.id, revision: original.revision, engine: 'remotion-compatibility', route, verification: 'not-run',
    summary: browser ? 'Full Remotion composition' : artwork ? 'Native video with Remotion artwork' : 'Native video candidate',
    blockers: eligibility.blockers,
    stages: [
      {id: 'decode', label: 'Video decoding', execution: !footage ? 'none' : browser || softwareEncoding ? 'cpu' : 'conditional',
        description: !footage ? 'No video source in this range.' : browser ? 'Remotion extracts source frames on CPU.' : softwareEncoding ? 'Software video decoding.' : 'GPU decoding depends on the source format and selected driver.'},
      {id: 'processing', label: 'Video effects and composition', execution: browser ? 'browser' : cpuGrading || softwareEncoding ? 'cpu' : 'conditional',
        description: browser ? 'The browser may accelerate some effects; full GPU execution is not guaranteed.' : cpuGrading ? 'Grading and base-video opacity currently use CPU filters.' : softwareEncoding ? 'Native FFmpeg software filters.' : 'Direct GPU surfaces and supported CUDA filters are candidates. Other geometry, color conversion and overlays still use CPU filters.'},
      {id: 'artwork', label: 'Text and assets', execution: artwork ? 'browser' : 'none',
        description: artwork ? 'Shared React assets use browser rendering, with CPU layout and PNG preparation.' : 'No graphic asset in this range.'},
      {id: 'transfer', label: 'Image transfer', execution: browser || artwork ? 'cpu' : softwareEncoding ? 'cpu' : 'conditional',
        description: browser ? 'Lossless PNG frames pass through CPU memory to the encoder.' : artwork ? 'Artwork PNGs are prepared on CPU and uploaded when GPU composition is available.' : softwareEncoding ? 'Frames remain in CPU memory.' : 'Frames stay on GPU only if the complete source/filter/encoder path supports them.'},
      {id: 'encode', label: 'Video encoding', execution: softwareEncoding ? 'cpu' : 'conditional',
        description: softwareEncoding ? 'Software encoding selected or required by this codec.' : 'Selected GPU compatibility is checked when you export. Hardware encoding alone does not accelerate the other stages.'},
      {id: 'audio', label: 'Audio', execution: settings.audio ? 'cpu' : 'none', description: settings.audio ? 'Audio mixing and encoding are handled separately on CPU.' : 'Audio export disabled.'},
    ],
    notes: ['This plan does not run hardware tests or render media. Source pixel formats, color metadata and installed filters may require the full composition at export.',
      'The optional native GPU renderer supports full-canvas SDR video cuts and scaling. The compatibility renderer preserves every existing effect.'],
  };
}

function describeNativeGpuPlan(project: Project, settings: import('./media-settings').ExportSettings): RenderPlan {
  if(settings.renderer === 'native-vulkan') return describeVulkanScene(project, settings);
  const plan = nativeGpuPlan(project, settings);
  return {
    projectId: project.id, revision: project.revision, engine: 'native-gpu', route: plan.blockers.length ? 'unsupported' : 'native-gpu', verification: 'not-run',
    summary: plan.blockers.length ? 'Native GPU · unsupported operations' : 'Native GPU · video cuts and scaling', blockers: plan.blockers,
    stages: [
      {id: 'decode', label: 'Video decoding', execution: 'gpu-required', description: 'VA-API (AMD/Linux), D3D11 (AMD/Windows) or CUDA (NVIDIA). Hardware-format constraints reject software decoding.'},
      {id: 'processing', label: 'Video effects and composition', execution: 'gpu-required', description: 'Full-canvas scaling through VA-API, AMF or CUDA. Unsupported composition and effects block this mode.'},
      {id: 'artwork', label: 'Text and assets', execution: 'none', description: 'Native GPU asset rendering is not implemented yet. Visible artwork blocks export; recipes remain available through the compatible renderer.'},
      {id: 'transfer', label: 'Image transfer', execution: 'gpu-required', description: 'Video surfaces stay on the same GPU through decoding, scaling and encoding. No browser, PNG intermediates or CPU pixel transfers.'},
      {id: 'encode', label: 'Video encoding', execution: 'gpu-required', description: 'Hardware encoder required. One sequential video worker; no software fallback or retry after a hardware failure.'},
      {id: 'audio', label: 'Audio', execution: settings.audio ? 'cpu' : 'none', description: settings.audio ? 'Source audio, volume and fades are processed separately on CPU. Container writing and packet I/O also use CPU.' : 'Audio export disabled. Container writing and packet I/O still use CPU.'},
    ],
    notes: ['Experimental export engine. Source headers and FFmpeg interfaces are checked at export. Requires 8-bit, progressive, square-pixel, explicitly tagged limited-range BT.709 SDR sources. No hardware test runs when opening this panel.',
      'Preview still uses the existing shared composition. Multitrack composition, GPU assets, grading, transitions and native preview are subsequent increments.'],
  };
}

function describeVulkanScene(project: Project, settings: import('./media-settings').ExportSettings): RenderPlan {
  const scene = nativeScenePlan(project, settings);
  const footage = scene.spans.some(span => sourceLayers(span).some(layer => layer.asset.kind === 'video'));
  const images = scene.spans.some(span => sourceLayers(span).some(layer => layer.asset.kind === 'image' && !layer.artwork && !layer.textClip));
  const artwork = scene.spans.some(span => sourceLayers(span).some(layer => layer.artwork || layer.textClip || layer.animation?.clip.presetTransition));
  const maxLayers = scene.spans.reduce((max, span) => Math.max(max, sceneLayers(span).length), 0);
  return {projectId: project.id, revision: project.revision, engine: 'native-vulkan', route: scene.blockers.length ? 'unsupported' : 'native-vulkan', verification: 'not-run',
    summary: scene.blockers.length ? 'Vulkan composition · unsupported effects' : `Vulkan composition · up to ${maxLayers} visual layers`, blockers: scene.blockers,
    stages: [
      {id: 'decode', label: 'Video decoding', execution: footage ? 'gpu-required' : 'none', description: 'Vulkan Video decoding on the selected AMD/NVIDIA GPU. Codec/driver support required; software decoding is rejected.'},
      {id: 'processing', label: 'Video effects and composition', execution: 'gpu-required', description: 'Vulkan composes live nested sequence groups in GPU textures, videos and image textures, crop, animated placement/scale/rotation/opacity, rectangle/ellipse/polygon masks with inversion and Gaussian feather, zoom and standard fade/slide/diagonal/pixel transitions. Bézier curves and last-frame transition holds run on GPU. GPU shaders apply the shared clip grade followed by the timeline grade to source media only.'},
      {id: 'artwork', label: 'Titles and saved assets', execution: artwork ? 'gpu-required' : 'none', description: 'GPU shaders draw recipe shapes, vector glyphs, strokes, animations and custom transition reveals. Direct titles support static/rise/typewriter animation, text-box crops and clean, highlighted or boxed captions.'},
      {id: 'asset-preparation', label: 'Asset preparation', execution: images || artwork ? 'cpu' : 'none', description: 'Font selection, text shaping, outline geometry and recipe compilation run once before GPU rendering. Text is never rasterized to CPU bitmaps. Imported PNG/JPEG/WebP/AVIF images still decode to RGBA once per job on CPU.'},
      {id: 'transfer', label: 'Image transfer', execution: 'gpu-required', description: images ? 'Each image texture is uploaded once per GPU batch, then reused on GPU. Video frames stay on one Vulkan device from decoding through composition and encoding; no frame downloads.' : 'Video frames stay on one Vulkan device through decoding, composition and encoding. No browser, cross-API transfer, video pixel uploads or downloads.'},
      {id: 'encode', label: 'Video encoding', execution: 'gpu-required', description: 'Vulkan Video hardware encoder required. Encoded spans are concatenated without re-encoding the video.'},
      {id: 'audio', label: 'Audio', execution: settings.audio ? 'cpu' : 'none', description: settings.audio ? 'All audible video and audio tracks are mixed separately on CPU, with clip/master volume and frame-based envelopes.' : 'Audio export disabled.'},
    ], notes: ['Experimental Vulkan composition. Source SDR metadata, FFmpeg interfaces and an estimated memory budget are checked at export. This plan does not initialize or validate a GPU.',
      'Requires compatible Vulkan Video decoding AND encoding drivers on Windows/Linux. A working VA-API, AMF or NVENC encoder does not establish Vulkan Video support. Preview retains the shared browser composition.']};
}
