import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';

const mocks = vi.hoisted(() => ({candidates: vi.fn(), inspect: vi.fn(), encode: vi.fn(), probe: vi.fn(), compatible: vi.fn(), select: vi.fn()}));
vi.mock('../server/services/encoder-service', () => ({EncoderService: class {nativeCandidates = mocks.candidates; select = mocks.select;}}));
vi.mock('../server/services/rendering/native-gpu-source', () => ({inspectNativeGpuSource: mocks.inspect}));
vi.mock('../server/services/ffmpeg-progress-service', () => ({runEncodingProcess: mocks.encode}));
vi.mock('../server/services/process-service', () => ({runProcess: mocks.probe, ffprobePath: () => 'ffprobe'}));
vi.mock('../server/services/rendering/remotion-engine', () => ({remotionEngine: {render: mocks.compatible}}));
import {renderProject} from '../server/services/render-engine';

let directory = '';
afterEach(async () => {vi.unstubAllEnvs(); vi.resetAllMocks(); if(directory) await rm(directory, {recursive: true, force: true}); directory = '';});

async function fixture() {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-gpu-unit-'));
  const asset = {id: 'video', kind: 'video' as const, name: 'Original footage', src: '/media/original.mp4', previewSrc: '/media/proxy.mp4', duration: 10, width: 640, height: 360, fps: 30};
  const project = {...createDemo(), width: 640, height: 360, fps: 30, assets: [asset],
    clips: [0, 1].map(index => clipSchema.parse({id: `cut-${index}`, name: `Cut ${index}`, kind: 'video', track: 'visual', assetId: asset.id, start: 30 * index, duration: 30, sourceStart: 90 - index * 30}))};
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-gpu', encoder: 'nvidia', audio: false});
  mocks.inspect.mockResolvedValue({audio: true, duration: 10});
  mocks.candidates.mockResolvedValue([{vendor: 'nvidia', backend: 'nvenc', name: 'h264_nvenc', binary: 'ffmpeg', label: 'NVIDIA NVENC'}]);
  mocks.probe.mockImplementation(async (_binary: string, args: string[]) => {
    if(args.includes('-filters')) return ' ... scale_cuda V->V GPU scale';
    if(args.includes('-hwaccels')) return 'cuda';
    return JSON.stringify({streams: [{width: 320, height: 180, sample_aspect_ratio: '1:1'}]});
  });
  mocks.encode.mockImplementation(async (_binary: string, args: string[], options: {onProgress: (value: unknown) => void}) => {
    await writeFile(args.at(-1)!, 'encoded-output');
    options.onProgress({frame: 30, outTimeUs: 1_000_000, totalSize: 100});
  });
  const exports = path.join(directory, 'exports'); await mkdir(exports);
  return {project, workspace: directory, exports, root: directory, mediaBase: '', job: {id: 'unit-export', kind: 'video' as const, status: 'rendering' as const, progress: 0, revision: project.revision, settings}};
}

it('publishes only completed output, reuses source metadata, and dispatches without the compatibility engine', async () => {
  const task = await fixture();
  const updates = vi.fn();
  const filename = await renderProject(task, updates);
  expect(await readFile(path.join(task.exports, filename), 'utf8')).toBe('encoded-output');
  expect(await readdir(task.exports)).toEqual([filename]);
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  expect(mocks.inspect.mock.calls[0][0]).toMatch(/original\.mp4$/);
  expect(mocks.encode).toHaveBeenCalledTimes(3); // Two GPU parts, one packet-copy mux.
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.compatible).not.toHaveBeenCalled();
  expect(updates.mock.calls.at(-1)?.[0].detail).toContain('60 frames');
});

it('stops on the first hardware failure without retry, CPU/browser fallback or published output', async () => {
  const task = await fixture();
  mocks.encode.mockRejectedValue(new Error('GPU device lost'));
  await expect(renderProject(task, vi.fn())).rejects.toThrow('No CPU/browser fallback was used');
  expect(mocks.encode).toHaveBeenCalledTimes(1);
  expect(mocks.compatible).not.toHaveBeenCalled();
  expect(await readdir(task.exports)).toEqual([]);
});

it('blocks disabled GPU use and invalid sources before adapter initialization', async () => {
  const task = await fixture();
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '1');
  await expect(renderProject(task, vi.fn())).rejects.toThrow('disabled');
  expect(mocks.candidates).not.toHaveBeenCalled();
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  mocks.inspect.mockRejectedValue(new Error('Source color metadata missing'));
  await expect(renderProject(task, vi.fn())).rejects.toThrow('color metadata');
  expect(mocks.candidates).not.toHaveBeenCalled();
  expect(mocks.encode).not.toHaveBeenCalled();
});
