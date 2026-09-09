import {expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {presetDefinitionSchema} from '../shared/asset-presets';
import {layeredRenderPlan, overlayRunsForSegment} from '../shared/layered-render-plan';
import {segmentArguments} from '../server/services/layered-render-service';
import {hardwareEncodingArguments} from '../server/services/encoding-arguments';
import {routeHardwareEncoder} from '../server/services/remotion-encoder-adapter';
import {ffmpegPath, ffprobePath, runProcess} from '../server/services/process-service';
import {filterFrameBudget} from '../server/services/render-resources-service';

function fixture() {
  const project = {...createDemo(), fps: 24, width: 128, height: 72, assets: [{id: 'video', name: 'source', kind: 'video' as const, src: '/media/source.mp4', duration: 3, width: 128, height: 72}], clips: [
    clipSchema.parse({id: 'a', name: 'a', kind: 'video', track: 'visual', assetId: 'video', start: 0, duration: 12, sourceStart: 24}),
    clipSchema.parse({id: 'b', name: 'b', kind: 'video', track: 'visual', assetId: 'video', start: 12, duration: 12, sourceStart: 0}),
  ]};
  const settings = exportSettingsSchema.parse({width: 128, height: 72, fps: 24, encoder: 'cpu'});
  return {project, settings};
}

it('preserves trimmed cut boundaries and caches only identical artwork states', () => {
  const {project, settings} = fixture();
  const definition = presetDefinitionSchema.parse({schemaVersion: 1, name: 'Fade', category: 'overlay', duration: 1, parameters: [],
    layers: [{id: 'box', type: 'rect', opacity: {keyframes: [{at: 0, value: 0}, {at: .2, value: 1}, {at: .8, value: 1}, {at: 1, value: 0}]}}]});
  project.clips.push(clipSchema.parse({id: 'overlay', name: 'overlay', kind: 'graphic', track: 'text', start: 0, duration: 24,
    graphic: {presetId: 'fade', version: 1, definition, values: {}, duration: 1}}));
  const plan = layeredRenderPlan(project, {...settings, startSeconds: .25, endSeconds: .75})!;
  expect(plan.segments.map(segment => [segment.start, segment.duration, segment.sourceStart])).toEqual([[6, 6, 30], [12, 6, 0]]);
  expect(plan.overlayFrames).toEqual([6]);
  expect(overlayRunsForSegment(plan, plan.segments[1])).toEqual([{frame: 6, duration: 6}]);
  const animated = layeredRenderPlan(project, settings)!;
  expect(animated.overlayFrames.length).toBeGreaterThan(1);
  expect(animated.overlayFrames.length).toBeLessThan(24);
  expect(animated.overlayRuns.reduce((total, run) => total + run.duration, 0)).toBe(24);
});

it('keeps the full renderer for transforms, gaps and additional audio/video', () => {
  const {project, settings} = fixture();
  expect(layeredRenderPlan(project, settings)).not.toBeNull();
  expect(layeredRenderPlan({...project, clips: project.clips.map(clip => ({...clip, scale: 1.2}))}, settings)).toBeNull();
  expect(layeredRenderPlan({...project, clips: project.clips.slice(1)}, settings)).toBeNull();
  const audio = clipSchema.parse({id: 'music', name: 'Music', kind: 'audio', track: 'audio', assetId: 'video', start: 0, duration: 24});
  expect(layeredRenderPlan({...project, clips: [...project.clips, audio]}, settings)).toBeNull();
});

it('routes only the GPU encoding command externally, keeping audio and muxing on bundled FFmpeg', () => {
  const require = createRequire(import.meta.url);
  const calls = require(path.join(path.dirname(require.resolve('@remotion/renderer')), 'call-ffmpeg.js'));
  const originals = {callFf: calls.callFf, callFfNative: calls.callFfNative};
  try {
    calls.callFf = calls.callFfNative = (options: unknown) => options;
    routeHardwareEncoder('/private/gpu-binaries', 'h264_vaapi');
    expect(calls.callFf({args: ['-filter_script:a', 'mix.txt'], binariesDirectory: '/wrong'}).binariesDirectory).toBeNull();
    expect(calls.callFf({args: ['-c:v', 'copy'], binariesDirectory: '/wrong'}).binariesDirectory).toBeNull();
    expect(calls.callFfNative({args: ['-c:v', 'h264_vaapi'], binariesDirectory: null}).binariesDirectory).toBe('/private/gpu-binaries');
  } finally {Object.assign(calls, originals);}
});

it('encodes a short synthetic cut with transparent artwork and correctly sized PCM audio', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-layered-test-'));
  const ffmpeg = ffmpegPath();
  try {
    const source = path.join(directory, 'source.mp4'); const png = path.join(directory, 'art.png'); const overlay = path.join(directory, 'art.ffconcat'); const output = path.join(directory, 'cut.nut');
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', '1', '-y', source], 15000);
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green@0.5:s=128x72,format=rgba', '-frames:v', '1', '-threads', '1', '-y', png], 15000);
    await writeFile(overlay, "ffconcat version 1.0\nfile 'art.png'\noption framerate 24\nduration 0.25\nfile 'art.png'\noption framerate 24\n");
    const {project, settings} = fixture(); const segment = {...layeredRenderPlan(project, settings)!.segments[0], sourceStart: 12, duration: 6};
    const args = segmentArguments({segment, settings, source, hasAudio: true, overlay, output, audioSamples: 12000});
    const gpuArgs = hardwareEncodingArguments(args, {vendor: 'amd', backend: 'vaapi', binary: ffmpeg, name: 'h264_vaapi', label: 'AMD', device: '/dev/dri/renderD128'}, settings);
    expect(gpuArgs).not.toContain('-vf');
    expect(gpuArgs[gpuArgs.indexOf('-filter_complex') + 1]).toContain('[video]format=nv12,hwupload[framecraft_encoded]');
    await runProcess(ffmpeg, args, 15000);
    const result = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output], 15000));
    expect(result.streams.find((stream: {codec_type: string}) => stream.codec_type === 'video').nb_read_frames).toBe('6');
    let bytes = 0;
    await runProcess(ffmpeg, ['-v', 'error', '-i', output, '-vn', '-f', 's16le', '-'], 15000, {onOutput: chunk => {bytes += chunk.length;}});
    expect(bytes).toBe(12000 * 2 * 2);
  } finally {await rm(directory, {recursive: true, force: true});}
}, 30000);

it('keeps long artwork holds bounded while preserving animation frames and audio', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'framecraft-held-art-test-'));
  const ffmpeg = ffmpegPath();
  try {
    const source = path.join(directory, 'source.mp4'), overlay = path.join(directory, 'art.ffconcat'), output = path.join(directory, 'cut.nut');
    await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=60:d=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-t', '10', '-y', source], 15000);
    for(const color of ['red', 'green']) await runProcess(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}@0.5:s=128x72,format=rgba`, '-frames:v', '1', '-threads', '1', '-y', path.join(directory, `${color}.png`)], 15000);
    const runs = [{color: 'red', frames: 1}, {color: 'green', frames: 1}, {color: 'red', frames: 240}, {color: 'green', frames: 1}, {color: 'red', frames: 1}, {color: 'green', frames: 236}];
    await writeFile(overlay, ['ffconcat version 1.0', ...runs.flatMap(run => [`file '${run.color}.png'`, 'option framerate 60', `duration ${(run.frames / 60).toFixed(12)}`]), "file 'green.png'", 'option framerate 60'].join('\n') + '\n');
    const help = await runProcess(ffmpeg, ['-hide_banner', '-h', 'long'], 10000);
    const budget = filterFrameBudget(2560, 1440, 4 * 1024 ** 3);
    expect(budget).toBeLessThanOrEqual(10);
    const settings = exportSettingsSchema.parse({width: 128, height: 72, fps: 60, encoder: 'cpu', preset: 'ultrafast'});
    const segment = {...layeredRenderPlan(fixture().project, fixture().settings)!.segments[0], sourceStart: 60, duration: 480};
    await runProcess(ffmpeg, segmentArguments({segment, settings, source, hasAudio: true, overlay, output, audioSamples: 384000,
      ...(help.includes('-filter_buffered_frames') ? {maxBufferedFrames: budget} : {})}), 15000);
    const chunks: Buffer[] = [];
    await runProcess(ffmpeg, ['-v', 'error', '-i', output, '-an', '-vf', 'crop=2:2:64:36,format=rgb24', '-f', 'rawvideo', '-'], 15000, {onOutput: chunk => chunks.push(chunk)});
    const pixels = Buffer.concat(chunks); expect(pixels.length).toBe(480 * 2 * 2 * 3);
    const colorAt = (frame: number) => pixels[frame * 12] > pixels[frame * 12 + 1] ? 'red' : 'green';
    expect([0, 1, 2, 241, 242, 243, 244, 479].map(colorAt)).toEqual(['red', 'green', 'red', 'red', 'green', 'red', 'green', 'green']);
    let bytes = 0;
    await runProcess(ffmpeg, ['-v', 'error', '-i', output, '-vn', '-f', 's16le', '-'], 15000, {onOutput: chunk => {bytes += chunk.length;}});
    expect(bytes).toBe(384000 * 2 * 2);
  } finally {await rm(directory, {recursive: true, force: true});}
}, 30000);
