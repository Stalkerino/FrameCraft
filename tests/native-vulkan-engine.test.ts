import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {defaultTracks} from '../shared/tracks';
const mocks = vi.hoisted(() => ({inspect: vi.fn(), encode: vi.fn(), probe: vi.fn(), select: vi.fn(), compatible: vi.fn()}));
vi.mock('../server/services/rendering/native-gpu-source', () => ({inspectNativeGpuSource: mocks.inspect}));
vi.mock('../server/services/rendering/vulkan-pipeline-service', () => ({VulkanPipelineService: class {select = mocks.select;}}));
vi.mock('../server/services/ffmpeg-progress-service', () => ({runEncodingProcess: mocks.encode}));
vi.mock('../server/services/process-service', () => ({runProcess: mocks.probe, ffprobePath: () => 'ffprobe'}));
vi.mock('../server/services/rendering/remotion-engine', () => ({remotionEngine: {render: mocks.compatible}}));
import {renderProject} from '../server/services/render-engine';

let directory = '';
afterEach(async () => {vi.unstubAllEnvs(); vi.resetAllMocks(); if(directory) await rm(directory, {recursive: true, force: true}); directory = '';});
async function fixture() {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  vi.stubEnv('FRAMECRAFT_GPU_BATCH_SPANS', '4');
  vi.stubEnv('FRAMECRAFT_GPU_BUDGET_MIB', '1024');
  directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-scene-unit-'));
  const project = {...createDemo(), width: 640, height: 360, fps: 30,
    tracks: [{id: 'upper', name: 'Video 2', type: 'visual' as const, muted: false, hidden: false}, ...defaultTracks],
    assets: [{id: 'rush', name: 'Rush', kind: 'video' as const, width: 640, height: 360, fps: 30, duration: 10, src: '/media/rush.mp4', previewSrc: '/media/proxy.mp4'}],
    clips: [clipSchema.parse({id: 'a', name: 'Base', kind: 'video', track: 'visual', assetId: 'rush', start: 0, duration: 20}),
      clipSchema.parse({id: 'b', name: 'Detail', kind: 'video', track: 'visual', trackId: 'upper', assetId: 'rush', start: 0, duration: 10, scale: .5})]};
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-vulkan', encoder: 'amd'});
  mocks.inspect.mockResolvedValue({duration: 10, audio: true});
  mocks.select.mockResolvedValue({binary: 'ffmpeg', encoder: 'h264_vulkan', vendor: 'amd', label: 'AMD Vulkan Video', initialize: ['-init_hw_device', 'vulkan=fc:AMD', '-filter_hw_device', 'fc']});
  mocks.probe.mockResolvedValue(JSON.stringify({streams: [{width: 320, height: 180, sample_aspect_ratio: '1:1'}]}));
  mocks.encode.mockImplementation(async (_binary: string, args: string[], options: {onProgress: (value: unknown) => void}) => {
    await writeFile(args.at(-1)!, 'encoded'); options.onProgress({frame: args.includes('-frames:v') ? Number(args[args.indexOf('-frames:v') + 1]) : 0, outTimeUs: 333333, totalSize: 64});
  });
  return {project, workspace: directory, exports: path.join(directory, 'exports'), root: directory, mediaBase: '',
    job: {id: 'scene', kind: 'video' as const, status: 'rendering' as const, progress: 0, revision: project.revision, settings}};
}

it('keeps one GPU process across changing scenes and preserves original audio boundaries', async () => {
  const task = await fixture();
  const filename = await renderProject(task, vi.fn());
  expect(await readdir(task.exports)).toEqual([filename]);
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  expect(mocks.inspect.mock.calls[0][0]).toMatch(/rush\.mp4$/);
  const calls = mocks.encode.mock.calls.map(([, args]) => args as string[]);
  const video = calls.filter(args => args.includes('h264_vulkan'));
  expect(video.map(args => args.filter(arg => arg === '-hwaccel').length)).toEqual([3]);
  expect(video[0]).toContain('-filter_buffered_frames');
  expect(calls.filter(args => args.includes('pcm_s16le'))).toHaveLength(3);
  expect(await readFile(video[0][video[0].indexOf('-/filter_complex') + 1], 'utf8')).toContain('libplacebo=inputs=3');
  expect(await readFile(video[0][video[0].indexOf('-/filter_complex') + 1], 'utf8')).toContain('concat=n=3:v=1:a=0');
  expect(calls.at(-1)?.[calls.at(-1)!.indexOf('-c:v') + 1]).toBe('copy');
  expect(mocks.compatible).not.toHaveBeenCalled();
});

it('never retries a failing device or substitutes browser/CPU processing', async () => {
  const task = await fixture(); mocks.encode.mockRejectedValue(new Error('Vulkan Video profile unsupported'));
  await expect(renderProject(task, vi.fn())).rejects.toThrow('No alternate GPU, CPU/browser fallback');
  expect(mocks.encode).toHaveBeenCalledTimes(1);
  expect(mocks.compatible).not.toHaveBeenCalled();
  await expect(readdir(task.exports)).rejects.toMatchObject({code: 'ENOENT'});
});

it('keeps the canvas when an offscreen video has no audio stream', async () => {
  const task = await fixture();
  task.project.clips = [clipSchema.parse({...task.project.clips[0], x: 100, crop: {left: 60, right: 0, top: 0, bottom: 0}, duration: 30})];
  mocks.probe.mockResolvedValue(JSON.stringify({streams: [{width: 320, height: 180, sample_aspect_ratio: '1:1'}], format: {duration: '10'}}));
  mocks.encode.mockImplementation(async (_binary: string, args: string[], options: {onProgress: (value: unknown) => void}) => {
    await writeFile(args.at(-1)!, 'encoded'); options.onProgress({frame: 30, outTimeUs: 1000000, totalSize: 64});
  });
  await expect(renderProject(task, vi.fn())).resolves.toMatch(/\.mp4$/);
  expect(mocks.inspect).not.toHaveBeenCalled();
  const video = mocks.encode.mock.calls.find(([, args]) => (args as string[]).includes('h264_vulkan'))![1] as string[];
  expect(video).not.toContain('-hwaccel');
  expect(mocks.compatible).not.toHaveBeenCalled();
});

it('rejects memory admission and GPU-disable before inspecting media or selecting a device', async () => {
  const task = await fixture(); vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '1');
  await expect(renderProject(task, vi.fn())).rejects.toThrow('disabled');
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0'); task.project.assets[0].width = 8192; task.project.assets[0].height = 8192;
  await expect(renderProject(task, vi.fn())).rejects.toThrow('GPU budget');
  expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.select).not.toHaveBeenCalled();
});
