import {afterEach, expect, it, vi} from 'vitest';
import {PreviewEncoderService} from '../server/services/preview-encoder-service';
import {EncoderService} from '../server/services/encoder-service';
import {nativeGpuAdapter, selectNativeGpuAdapter} from '../server/services/rendering/native-gpu-adapters';
import {runEncodingProcess} from '../server/services/ffmpeg-progress-service';
import {gpuPreviewArguments} from '../server/services/preview-encoding';
import type {HardwareEncoder} from '../server/services/encoding-arguments';
import {assetSchema} from '../shared/project';

vi.mock('../server/services/ffmpeg-progress-service', () => ({runEncodingProcess: vi.fn()}));
vi.mock('../server/services/rendering/native-gpu-adapters', async original => ({...await original<typeof import('../server/services/rendering/native-gpu-adapters')>(), selectNativeGpuAdapter: vi.fn()}));
afterEach(() => vi.restoreAllMocks());
const asset = assetSchema.parse({id: 'rush', name: 'Rush', kind: 'video', src: '/media/rush.mp4', duration: 12, width: 3840, height: 2160, fps: 60, videoCodec: 'h264'});
const nvidia: HardwareEncoder = {vendor: 'nvidia', backend: 'nvenc', name: 'h264_nvenc', label: 'NVIDIA NVENC', binary: 'gpu-ffmpeg'};

it('keeps proxy video on hardware surfaces on all four adapters with independently seekable frames', () => {
  for(const platform of ['linux', 'win32'] as const) for(const vendor of ['amd', 'nvidia'] as const) {
    const encoder: HardwareEncoder = vendor === 'nvidia' ? nvidia : {vendor, backend: platform === 'linux' ? 'vaapi' : 'amf', name: platform === 'linux' ? 'h264_vaapi' : 'h264_amf', device: '/dev/dri/renderD128', label: 'AMD', binary: 'ffmpeg'};
    const adapter = nativeGpuAdapter(encoder, platform);
    const args = gpuPreviewArguments(asset, 'performance', 'source path.mp4', 'output path.mp4', encoder, adapter);
    expect(args[args.indexOf('-hwaccel_output_format') + 1]).toBe(adapter.inputFormat);
    expect(args[args.indexOf('-vf') + 1]).toContain(adapter.scale({width: 1280, height: 720}));
    expect(args[args.indexOf('-g') + 1]).toBe('1');
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough');
    expect(args.join(' ')).not.toMatch(/hwdownload|hwupload|libx264/);
  }
});

it('falls back once after a GPU failure and never repeatedly initializes the failing driver', async () => {
  const inventory = new EncoderService(); vi.spyOn(inventory, 'previewCandidates').mockResolvedValue([nvidia]);
  vi.mocked(selectNativeGpuAdapter).mockResolvedValue({encoder: nvidia, adapter: nativeGpuAdapter(nvidia, 'linux')});
  vi.mocked(runEncodingProcess).mockReset().mockRejectedValueOnce(new Error('Driver rejected source')).mockResolvedValue(undefined);
  const encoder = new PreviewEncoderService(inventory); const info = vi.fn();
  for(let i = 0; i < 2; i++) await encoder.encode(asset, 'performance', 'source', 'output', new AbortController().signal, info, vi.fn());
  expect(vi.mocked(runEncodingProcess).mock.calls.map(call => call[0])).toEqual(['gpu-ffmpeg', expect.any(String), expect.any(String)]);
  expect(vi.mocked(runEncodingProcess).mock.calls.filter(call => call[0] === 'gpu-ffmpeg')).toHaveLength(1);
  expect(info).toHaveBeenLastCalledWith({encoding: 'CPU · 2 threads', warning: expect.stringContaining('Driver rejected source')});
  expect(inventory.previewCandidates).toHaveBeenCalledTimes(1);
});
