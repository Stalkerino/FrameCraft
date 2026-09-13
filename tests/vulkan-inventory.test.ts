import {afterEach, expect, it, vi} from 'vitest';
import {VulkanPipelineService} from '../server/services/rendering/vulkan-pipeline-service';
import {runProcess} from '../server/services/process-service';
import {exportSettingsSchema} from '../shared/media-settings';
import {resolveExecutable} from '../server/services/render-binaries-service';

vi.mock('../server/services/process-service', () => ({ffmpegPath: () => 'ffmpeg', runProcess: vi.fn()}));
vi.mock('../server/services/render-binaries-service', () => ({resolveExecutable: vi.fn(async () => '/test/ffmpeg'), bundledRenderBinary: () => '/test/ffmpeg'}));
afterEach(() => {vi.unstubAllEnvs(); vi.resetAllMocks();});

it('requires the complete Vulkan interfaces while selecting without hardware initialization', async () => {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  vi.mocked(runProcess).mockImplementation(async (_file, args) => args.includes('-encoders') ? ' V..... h264_vulkan Vulkan video' : args.includes('-filters') ? ' ... libplacebo V->V\n ... color_vulkan |->V' : args.includes('-hwaccels') ? 'vulkan' : '   inputs <int> Number of inputs');
  const service = new VulkanPipelineService();
  expect((await service.capabilities('h264')).encoders.every(candidate => candidate.available)).toBe(true);
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-vulkan', encoder: 'amd'});
  expect(await service.select(settings)).toMatchObject({binary: '/test/ffmpeg', encoder: 'h264_vulkan'});
  expect(runProcess).toHaveBeenCalledTimes(4); // Cached metadata reused by select.
  expect(vi.mocked(runProcess).mock.calls.every(([, args]) => !args.includes('-init_hw_device') && !args.includes('-i'))).toBe(true);
});

it('reports missing processing instead of accepting an encoder listing, and obeys GPU disable', async () => {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  vi.mocked(runProcess).mockImplementation(async (_file, args) => args.includes('-encoders') ? ' V..... h264_vulkan Vulkan video' : ' ... scale_vaapi V->V');
  const capabilities = await new VulkanPipelineService().capabilities('h264');
  expect(capabilities.encoders[0]).toMatchObject({available: false, reason: expect.stringContaining('missing libplacebo')});
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '1'); vi.mocked(runProcess).mockClear();
  expect((await new VulkanPipelineService().capabilities('h264')).encoders.every(candidate => !candidate.available)).toBe(true);
  expect(runProcess).not.toHaveBeenCalled();
});

it('prefers the isolated runtime and respects an explicit Vulkan-only executable', async () => {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '0');
  vi.mocked(resolveExecutable).mockImplementation(async command => command);
  vi.mocked(runProcess).mockImplementation(async (_file, args) => args.includes('-encoders') ? ' V..... h264_vulkan Vulkan video' : args.includes('-filters') ? ' ... libplacebo V->V\n ... color_vulkan |->V' : args.includes('-hwaccels') ? 'vulkan' : '   inputs <int> Number of inputs');
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-vulkan', encoder: 'amd'});
  expect((await new VulkanPipelineService().select(settings)).binary.replaceAll('\\', '/')).toContain('/.runtime/vulkan/');
  vi.stubEnv('FRAMECRAFT_VULKAN_FFMPEG', '/custom/ffmpeg');
  vi.mocked(resolveExecutable).mockClear();
  expect((await new VulkanPipelineService().select(settings)).binary).toBe('/custom/ffmpeg');
  expect(resolveExecutable).toHaveBeenCalledTimes(1);
  expect(process.env.FFMPEG_PATH).not.toBe('/custom/ffmpeg');
});
