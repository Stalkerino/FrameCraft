import {afterEach, expect, it, vi} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportSettingsSchema} from '../shared/media-settings';
import {renderLayeredVideo} from '../server/services/layered-render-service';
import {ProcessError, runProcess} from '../server/services/process-service';
import {runEncodingProcess} from '../server/services/ffmpeg-progress-service';

vi.mock('../server/services/process-service', async importOriginal => ({...await importOriginal<typeof import('../server/services/process-service')>(), runProcess: vi.fn()}));
vi.mock('../server/services/ffmpeg-progress-service', async importOriginal => ({...await importOriginal<typeof import('../server/services/ffmpeg-progress-service')>(), runEncodingProcess: vi.fn()}));

afterEach(() => vi.resetAllMocks());

for(const failure of ['missing-filter', 'geometry', 'probe', 'dimensions', 'runtime', 'cancel'] as const) it(`handles GPU ${failure} without losing the selected encoder or retrying cancellation`, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'framecraft-gpu-recovery-'));
  const filters = ['fps', 'scale', 'crop', 'pad', 'drawbox', 'color', 'setsar', 'tpad', 'trim', 'setpts', 'format', 'overlay', 'zscale', 'asetpts', 'aresample', 'volume', 'apad', 'atrim', 'anullsrc', 'scale_cuda'];
  const info = {codec_type: 'video', pix_fmt: 'yuv420p', width: 320, height: 180, color_space: 'bt709', color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709', sample_aspect_ratio: '1:1'};
  const error = new ProcessError('GPU operation failed', 'ffmpeg', failure === 'cancel' ? 'abort' : 'exit', 1, null, 'driver failure');
  vi.mocked(runProcess).mockImplementation(async (_binary, args, _timeout, options) => {
    if(args.includes('rawvideo')) {options?.onOutput?.(Buffer.alloc(64 * 48 * 3 / 2, failure === 'geometry' && args.includes('-init_hw_device') ? 32 : 128)); return '';}
    if(args.includes('-filters')) return filters.filter(filter => failure !== 'missing-filter' || filter !== 'scale_cuda').map(filter => ` .. ${filter} V->V`).join('\n');
    if(args.includes('-show_streams')) {
      const probe = args.at(-1)!.includes('probe-');
      return JSON.stringify({streams: [{...info, ...(probe ? {width: 640, height: failure === 'dimensions' ? 384 : 360} : {})}]});
    }
    if(args.at(-1)!.includes('probe-') && ['probe', 'cancel'].includes(failure)) throw error;
    return '';
  });
  vi.mocked(runEncodingProcess).mockResolvedValue();
  if(failure === 'runtime') vi.mocked(runEncodingProcess).mockRejectedValueOnce(error);
  const progress: {detail?: string; warning?: string}[] = [];
  const render = vi.fn();
  try {
    const pending = renderLayeredVideo({workspace, output: path.join(workspace, 'out.mp4'), render,
      settings: exportSettingsSchema.parse({width: 640, height: 360, fps: 30, audio: false}),
      hardware: {vendor: 'nvidia', backend: 'nvenc', binary: 'ffmpeg', name: 'h264_nvenc', label: 'NVIDIA NVENC'},
      plan: {baseTrackId: 'visual', firstFrame: 0, lastFrame: 5, overlayFrames: [], overlayRuns: [], segments: [{start: 0, duration: 6, sourceStart: 0, volume: 1,
        asset: {id: 'video', kind: 'video', name: 'Video', src: '/media/test.mp4', width: 320, height: 180, duration: 1, fps: 30}}]},
      onProgress: update => progress.push(update)});
    if(failure === 'cancel') {
      await expect(pending).rejects.toBe(error);
      expect(runEncodingProcess).not.toHaveBeenCalled();
      return;
    }
    await expect(pending).resolves.toBe(true);
    expect(render).not.toHaveBeenCalled();
    const calls = vi.mocked(runEncodingProcess).mock.calls;
    expect(calls).toHaveLength(failure === 'runtime' ? 2 : 1);
    const args = calls.at(-1)![1];
    expect(args).toContain('h264_nvenc');
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('scale_cuda');
    if(failure === 'runtime') expect(args).not.toContain('-hwaccel');
    else expect(args).toContain('-hwaccel');
    if(failure !== 'missing-filter') expect(progress.some(update => update.warning?.includes('CPU'))).toBe(true);
    expect(vi.mocked(runProcess).mock.calls.at(-1)![1]).toContain('copy');
  } finally {await rm(workspace, {recursive: true, force: true});}
});
