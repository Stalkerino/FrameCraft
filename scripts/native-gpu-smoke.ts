import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {vendor: {type: 'string'}, run: {type: 'boolean', default: false}, report: {type: 'string'}, composition: {type: 'boolean', default: false}, effects: {type: 'boolean', default: false}, animation: {type: 'boolean', default: false}, artwork: {type: 'boolean', default: false}, text: {type: 'boolean', default: false}, masks: {type: 'boolean', default: false}, keep: {type: 'boolean', default: false}}});
if(values.effects || values.animation || values.artwork || values.text || values.masks) values.composition = true;
if(values.vendor !== 'amd' && values.vendor !== 'nvidia') throw new Error('Choose --vendor amd or --vendor nvidia. Add --run only to explicitly run the bounded GPU check.');
if(!values.run) {
  console.log(`No GPU initialized. Planned check: ${values.vendor}/${process.platform}, one 640×360 source, ${values.composition ? 'Vulkan side-by-side composition, crop, audio mix and empty canvas' : 'two reordered cuts'}, 30 frames total at 320×180, one worker, 60-second process deadline.\nAdd --run to execute. This is a correctness check, not a benchmark. --report <path> saves its result.`);
} else {
  if(process.env.FRAMECRAFT_DISABLE_GPU === '1') throw new Error('FRAMECRAFT_DISABLE_GPU=1 blocks this hardware check.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-native-gpu-'));
  // Configure isolation before importing any application modules.
  process.env.FRAMECRAFT_DATA_DIR = directory;
  process.env.FRAMECRAFT_LIBRARY_DIR = path.join(directory, 'library');
  const {runProcess, ffmpegPath, ffprobePath, stopRunningProcesses} = await import('../server/services/process-service');
  const engine = values.composition ? (await import('../server/services/rendering/native-vulkan-engine')).nativeVulkanEngine : (await import('../server/services/rendering/native-gpu-engine')).nativeGpuEngine;
  const {createDemo} = await import('../shared/demo');
  const {clipSchema} = await import('../shared/project');
  const {exportSettingsSchema} = await import('../shared/media-settings');
  const sharp = (await import('sharp')).default;
  const result: Record<string, unknown> = {date: new Date().toISOString(), platform: process.platform, arch: process.arch, vendor: values.vendor,
    scope: values.composition ? '30 frames, static two-video composition, crop, empty background and audio duration; no validation of other codecs/resolutions, native assets or preview' : '30 frames, cuts and scaling only; does not validate other codecs, resolutions, native assets, composition or preview', status: 'failed'};
  const timer = setTimeout(() => {void stopRunningProcesses(new Error('Native GPU smoke check reached its 60-second deadline.'));}, 60000);
  console.log(`Running bounded native GPU check on ${values.vendor}/${process.platform}: 30 frames, 320×180 output, one worker. No GPU fallback or repeated hardware probes.`);
  try {
    const media = path.join(directory, 'media'); await mkdir(media);
    const file = path.join(media, 'source.mp4');
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-threads', '2', '-crf', '12', '-bf', '0', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-c:a', 'aac', '-y', file], 15000);
    const settings = exportSettingsSchema.parse({renderer: values.composition ? 'native-vulkan' : 'native-gpu', encoder: values.vendor, width: 320, height: 180, fps: 30, crf: 12});
    const project = {...createDemo(), id: 'native-gpu-smoke', width: 640, height: 360, fps: 30,
      assets: [{id: 'source', kind: 'video' as const, name: 'GPU smoke source', src: '/media/source.mp4', duration: 1, width: 640, height: 360, fps: 30}],
      clips: [15, 0].map((sourceStart, index) => clipSchema.parse({id: `cut-${index}`, name: `Cut ${index}`, kind: 'video', track: 'visual', assetId: 'source', start: index * 15, duration: 15, sourceStart}))};
    const updates: {phase: string; detail?: string; encoder?: string}[] = [];
    const sceneTools = values.composition ? await import('./vulkan-smoke-scene') : undefined;
    const animationTools = values.animation ? await import('./vulkan-animation-smoke') : undefined;
    const maskTools = values.masks ? await import('./vulkan-mask-smoke') : undefined;
    const artworkTools = values.artwork || values.text ? await import('./vulkan-artwork-smoke') : undefined;
    if(values.effects || values.animation || values.masks) await sharp(sceneTools!.effectsImagePixels(), {raw: sceneTools!.effectsImage}).png().toFile(path.join(media, 'image.png'));
    const renderProject = maskTools ? maskTools.maskSmokeProject(project) : artworkTools ? values.text ? artworkTools.textSmokeProject(project) : artworkTools.artworkSmokeProject(project) : animationTools ? animationTools.animationSmokeProject(project) : values.effects ? sceneTools!.effectsSmokeProject(project) : sceneTools ? sceneTools.compositionSmokeProject(project) : project;
    if(values.effects) result.scope = '30 frames, RGBA image, video/image opacity, clip and timeline grading, crop and audio; no validation of other platforms/resolutions/codecs';
    if(values.animation) result.scope = '30 frames, four standard transitions, held source frames, animated image position/scale/opacity, Bézier/hold easing and zoom; no validation of other platforms/resolutions/codecs';
    if(values.artwork) result.scope = '30 frames, animated saved recipes, rounded rectangles, ellipses, strokes, GPU vector text and custom iris transition, compared with software browser references; other platforms/resolutions unvalidated';
    if(values.text) result.scope = '30 frames, cropped multiline typewriter, trimmed/wrapped highlighted captions, boxed/clean captions, animated scaling; software-browser comparison on this OS/GPU only';
    if(values.masks) result.scope = '30 frames, rotated video/image/recipe/text, rotation curves, rectangle/ellipse/polygon masks, inversion, Gaussian feather and dynamic text boxes; software-browser references; this OS/GPU only';
    const outputName = await engine.render({project: renderProject, workspace: directory, exports: path.join(directory, 'exports'), root: process.cwd(), mediaBase: '',
      job: {id: 'native-gpu-smoke', kind: 'video', status: 'rendering', progress: 0, revision: project.revision, settings}}, update => {
      updates.push({phase: update.phase, detail: update.detail, encoder: update.encoder});
      if(updates.at(-2)?.phase !== update.phase) console.log(`${update.phase}: ${update.detail ?? ''}`);
    });
    const output = path.join(directory, 'exports', outputName);
    // CPU readback exists only in this explicit correctness harness, never in
    // the native export engine. Count frames and compare both reordered cuts.
    const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output], 10000));
    const video = probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'video');
    const audio = probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'audio');
    if(video.width !== 320 || video.height !== 180 || Number(video.nb_read_frames) !== 30 || !Number.isFinite(Number(audio?.duration)) || Math.abs(Number(audio?.duration) - 1) > .06) throw new Error('Unexpected frame count, dimensions or audio duration.');
    const differences: number[] = maskTools ? await maskTools.compareMaskSmoke(output, directory, renderProject) : artworkTools ? await artworkTools.compareArtworkSmoke(output, directory, renderProject, values.text) : animationTools ? await animationTools.compareAnimationSmoke(output, file, directory, renderProject) : sceneTools ? await sceneTools.compareCompositionSmoke(output, file, directory, values.effects ? renderProject : undefined) : [];
    for(const [frame, sourceFrame] of sceneTools ? [] : [[3, 18], [20, 5]]) {
      const pixels: Buffer[] = [];
      for(const [index, input] of [output, file].entries()) {
        const png = path.join(directory, `frame-${frame}-${index}.png`);
        const selectedFrame = index ? sourceFrame : frame;
        await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-i', input, '-an', '-vf', `select=eq(n\\,${selectedFrame}),scale=320:180:flags=lanczos`, '-frames:v', '1', '-y', png], 10000);
        pixels.push(await sharp(await readFile(png)).removeAlpha().raw().toBuffer());
      }
      const error = pixels[0].reduce((sum, value, index) => sum + Math.abs(value - pixels[1][index]), 0) / pixels[0].length;
      differences.push(error);
      if(error > 14) throw new Error(`Cut ${frame} differs from its source reference (mean pixel error ${error.toFixed(2)}).`);
    }
    const batches = updates.filter(update => update.phase === 'Starting Vulkan batch');
    Object.assign(result, {status: 'passed', frames: 30, meanPixelErrors: differences, ...(values.composition ? {gpuProcesses: batches.length, batches} : {}), pipeline: updates.find(update => update.phase === (values.composition ? 'Starting native Vulkan export' : 'Starting native GPU export'))});
    console.log(`Passed: ${values.masks ? 'GPU rotation and masks' : values.text ? 'GPU titles and timed captions' : values.artwork ? 'GPU recipes and vector text' : values.animation ? 'animation and transitions' : values.effects ? 'images, opacity, grading and scene changes' : values.composition ? 'static composition, crop, empty canvas' : 'cuts and scaling'}, 30 frames and audio duration${values.composition ? `, ${batches.length} GPU process(es)` : ''}. Pixel errors: ${differences.map(value => value.toFixed(2)).join(', ')}. This validates only this OS/GPU and small SDR case.`);
  } catch(error) {
    result.error = (error as Error).message;
    let cause = error as Error & {stderr?: string};
    while(cause.cause instanceof Error) cause = cause.cause as typeof cause;
    if(cause.stderr) result.diagnostics = cause.stderr;
    console.error(result.error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await stopRunningProcesses();
    if(values.keep) {result.artifacts = directory; console.log(`Test artifacts: ${directory}`);}
    else await rm(directory, {recursive: true, force: true});
    if(values.report) await writeFile(path.resolve(values.report), JSON.stringify(result, null, 2) + '\n');
  }
}
