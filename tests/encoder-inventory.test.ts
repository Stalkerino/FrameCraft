import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {EncoderService} from '../server/services/encoder-service';
import {runProcess} from '../server/services/process-service';
import {exportSettingsSchema} from '../shared/media-settings';
import {renderBrowserGl} from '../server/services/render-browser-service';

vi.mock('../server/services/process-service', () => ({ffmpegPath: () => 'ffmpeg', runProcess: vi.fn()}));
vi.mock('../server/services/render-binaries-service', () => ({resolveExecutable: async () => '/test/ffmpeg', bundledRenderBinary: () => '/test/ffmpeg'}));
vi.mock('node:fs/promises', async original => ({...await original<typeof import('node:fs/promises')>(), readdir: async () => ['renderD128'], readFile: async () => '0x1002'}));
beforeEach(() => {vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0'); vi.mocked(runProcess).mockResolvedValue(' V..... h264_nvenc NVIDIA NVENC\n V..... h264_vaapi VAAPI\n');});
afterEach(() => {vi.unstubAllEnvs(); vi.clearAllMocks();});

it('reads and caches inventory without initializing any encoder or GPU device', async () => {
  const service = new EncoderService();
  const [first, second] = await Promise.all([service.capabilities('h264'), service.capabilities('h264')]);
  expect(first).toBe(second);
  expect(first.verification).toBe('not-run');
  expect(first.encoders.find(encoder => encoder.id === 'nvidia')).toMatchObject({available: true, encoder: 'h264_nvenc'});
  expect(runProcess).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runProcess).mock.calls[0][1]).toEqual(['-hide_banner', '-encoders']);
});

it('does not initialize GPU hardware in the disabled process, even for an explicit GPU request', async () => {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '1');
  const service = new EncoderService();
  const settings = exportSettingsSchema.parse({width: 128, height: 72, fps: 30});
  expect((await service.capabilities('h264')).encoders.every(encoder => !encoder.available)).toBe(true);
  expect(await service.select(settings)).toMatchObject({label: 'CPU'});
  await expect(service.select({...settings, encoder: 'amd'})).rejects.toThrow('GPU use is disabled');
  expect(renderBrowserGl('win32')).toBe('swangle');
  expect(renderBrowserGl('linux')).toBe('swangle');
  expect(runProcess).not.toHaveBeenCalled();
});
