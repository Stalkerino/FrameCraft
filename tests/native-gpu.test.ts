import {describe, expect, it} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {nativeGpuPlan, requireNativeGpuPlan} from '../shared/native-gpu-plan';
import {describeRenderPlan} from '../shared/render-plan';
import {nativeGpuAdapter} from '../server/services/rendering/native-gpu-adapters';
import {nativeGpuAudioArguments, nativeGpuMuxArguments, nativeGpuVideoArguments} from '../server/services/rendering/native-gpu-commands';
import {validateNativeGpuSource} from '../server/services/rendering/native-gpu-source';
import type {HardwareEncoder} from '../server/services/encoding-arguments';

export function nativeFixture() {
  const asset = {id: 'rush', kind: 'video' as const, name: 'Rush', src: '/media/rush.mp4', width: 640, height: 360, duration: 10, fps: 30};
  const project = {...createDemo(), width: 640, height: 360, fps: 30, assets: [asset], clips: [
    clipSchema.parse({id: 'a', name: 'First', kind: 'video', track: 'visual', assetId: 'rush', start: 0, duration: 30, sourceStart: 90}),
    clipSchema.parse({id: 'b', name: 'Second', kind: 'video', track: 'visual', assetId: 'rush', start: 30, duration: 30, sourceStart: 15,
      audioEnvelope: {duration: 30, fadeIn: 10}}),
  ]};
  const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, renderer: 'native-gpu', encoder: 'amd'});
  return {asset, project, settings};
}

it('plans reordered cuts, range trims and frame-rate conversion with the shared audio clock', () => {
  const {project, settings} = nativeFixture();
  const ranged = {...settings, fps: 60, startSeconds: .5, endSeconds: 1.5};
  const plan = requireNativeGpuPlan(project, ranged);
  expect(plan).toMatchObject({firstFrame: 30, frameCount: 60, blockers: []});
  expect(plan.segments.map(({start, duration, sourceStart}) => ({start, duration, sourceStart}))).toEqual([
    {start: 30, duration: 30, sourceStart: 210}, {start: 60, duration: 30, sourceStart: 30},
  ]);
  const middle = requireNativeGpuPlan(project, {...settings, startSeconds: 1.2, endSeconds: 1.8});
  expect(middle.segments[0].audioEnvelope).toMatchObject({offset: 6, fadeIn: 10});
  expect(describeRenderPlan(project, {settings}).route).toBe('native-gpu');
  expect(project.clips[1].audioEnvelope?.offset).toBe(0);
});

it('blocks unsupported effects, empty regions, overlaps and artwork without losing them', () => {
  const {project, settings} = nativeFixture();
  project.clips[0].opacity = .5;
  project.clips[1].start = 40;
  project.clips.push(clipSchema.parse({id: 'title', name: 'Title', kind: 'text', track: 'text', start: 0, duration: 30, text: 'Keep me'}));
  const before = structuredClone(project);
  expect(nativeGpuPlan(project, settings).blockers.map(item => item.code)).toEqual(expect.arrayContaining(['gap', 'color-opacity', 'artwork']));
  expect(() => requireNativeGpuPlan(project, settings)).toThrow('Title');
  expect(describeRenderPlan(project, {settings}).route).toBe('unsupported');
  project.clips[1].start = 20;
  expect(nativeGpuPlan(project, settings).blockers.map(item => item.code)).toContain('overlap');
  project.clips[1].start = 40;
  expect(project).toEqual(before);
});

it('defaults older projects to compatibility and rejects software selection for native mode', () => {
  expect(exportSettingsSchema.parse({width: 640, height: 360, fps: 30}).renderer).toBe('compatible');
  const {settings} = nativeFixture();
  for(const encoder of ['auto', 'cpu']) expect(exportSettingsSchema.safeParse({...settings, encoder}).success).toBe(false);
  expect(exportSettingsSchema.safeParse({...settings, codec: 'prores'}).success).toBe(false);
});

const platforms: {platform: NodeJS.Platform; encoder: HardwareEncoder; format: string; filter: string}[] = [
  {platform: 'linux', encoder: {vendor: 'amd', backend: 'vaapi', name: 'h264_vaapi', label: 'AMD VA-API', binary: '/usr/bin/ffmpeg', device: '/dev/dri/renderD129'}, format: 'vaapi', filter: 'scale_vaapi'},
  {platform: 'win32', encoder: {vendor: 'amd', backend: 'amf', name: 'h264_amf', label: 'AMD AMF', binary: 'C:\\Program Files\\FFmpeg\\ffmpeg.exe'}, format: 'amf', filter: 'vpp_amf'},
  ...(['linux', 'win32'] as const).map(platform => ({platform, encoder: {vendor: 'nvidia' as const, backend: 'nvenc' as const, name: 'h264_nvenc', label: 'NVIDIA NVENC', binary: 'ffmpeg'}, format: 'cuda', filter: 'scale_cuda'})),
];
describe.each(platforms)('$platform / $encoder.vendor native contract', ({platform, encoder, format, filter}) => {
  it('requires hardware at both ends, shares one device, bounds queues and never transfers pixels to CPU', () => {
    const {project, settings} = nativeFixture();
    const adapter = nativeGpuAdapter(encoder, platform);
    const segment = requireNativeGpuPlan(project, settings).segments[0];
    const source = platform === 'win32' ? 'C:\\User media\\rush.mp4' : '/tmp/user media/rush.mp4';
    const args = nativeGpuVideoArguments(segment, settings, source, 'out.nut', encoder, adapter);
    expect(args[args.indexOf('-i') + 1]).toBe(source);
    expect(args[args.indexOf('-hwaccel_device') + 1]).toBe('fc');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('+' + format);
    expect(args[args.indexOf('-vf') + 1]).toContain(`format=pix_fmts=${adapter.inputFormat}`);
    expect(args[args.indexOf('-vf') + 1]).toContain(filter);
    expect(args[args.indexOf('-frames:v') + 1]).toBe('30');
    expect(args).toContain('-noauto_conversion_filters');
    expect(args.join(' ')).not.toMatch(/hwdownload|hwupload|libx264|\bscale=|\.png|swscale/);
    expect(args.filter(value => value === '-vaapi_device')).toHaveLength(0);
    if(platform === 'win32' && encoder.vendor === 'amd') expect(args).toEqual(expect.arrayContaining(['d3d11va=fc:,vendor_id=0x1002', 'amf=fc_amf@fc']));
    expect(args.at(-1)).toBe('out.nut');
  });
});

it('keeps audio and final mux separate from decoded video and preserves sample limits', () => {
  const {project, settings} = nativeFixture(); const segment = requireNativeGpuPlan(project, settings).segments[1];
  const audio = nativeGpuAudioArguments(segment, settings, 'rush.mp4', 'audio.wav', true, 48000);
  expect(audio).toContain('-vn');
  expect(audio[audio.indexOf('-af') + 1]).toContain('atrim=end_sample=48000');
  const mux = nativeGpuMuxArguments('video.ffconcat', 'audio.ffconcat', 'output.mp4', settings);
  expect(mux[mux.indexOf('-c:v') + 1]).toBe('copy');
  expect(mux).not.toContain('-vf');
});

it('refuses HDR, untagged sources and changed geometry instead of silently changing their colors', () => {
  const {asset} = nativeFixture();
  const video = {codec_type: 'video', codec_name: 'h264', width: 640, height: 360, duration: '10', pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', field_order: 'progressive', color_space: 'bt709', color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709'};
  expect(validateNativeGpuSource({streams: [video, {codec_type: 'audio'}]}, asset)).toEqual({audio: true, duration: 10});
  // This recording has 2462 frames. Its printed decimal loses a frame if floored.
  const recorded = validateNativeGpuSource({streams: [{...video, duration: '41.033333', duration_ts: 2462, time_base: '1/60'}], format: {duration: '41.045000'}}, asset);
  expect(Math.floor(recorded.duration * 60 + 1e-7)).toBe(2462);
  expect(2463 > Math.floor(recorded.duration * 60 + 1e-7)).toBe(true);
  expect(() => validateNativeGpuSource({streams: [{...video, color_transfer: 'smpte2084'}]}, asset)).toThrow('BT.709');
  expect(() => validateNativeGpuSource({streams: [{...video, color_space: undefined}]}, asset)).toThrow('BT.709');
  expect(() => validateNativeGpuSource({streams: [{...video, width: 1280}]}, asset)).toThrow('dimensions changed');
  expect(() => validateNativeGpuSource({streams: [{...video, side_data_list: [{rotation: 90}]}]}, asset)).toThrow('rotation');
});
