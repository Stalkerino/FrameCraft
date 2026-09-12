import {expect, it} from 'vitest';
import {clipSchema, type Asset} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {videoPlacement} from '../shared/video-placement';
import {canKeepHardwareFrames, segmentArguments} from '../server/services/layered-render-service';
import {hardwareEncodingArguments} from '../server/services/encoding-arguments';
import {hardwareBrowserStatus} from '../server/services/render-browser-service';

const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30, audio: false});
const asset: Asset = {id: 'video', name: 'Video', kind: 'video', src: '/media/test.mp4', width: 320, height: 180, fps: 30, duration: 1};
const clip = clipSchema.parse({id: 'clip', name: 'Clip', kind: 'video', assetId: asset.id, track: 'visual', start: 0, duration: 30});

it('keeps cropped pixels at the same canvas position instead of stretching the crop', () => {
  expect(videoPlacement({...clip, crop: {left: 10, right: 20, top: 10, bottom: 10}}, asset, settings, settings)).toEqual({
    source: {x: 32, y: 18, width: 224, height: 144}, destination: {x: 32, y: 18, width: 224, height: 144}});
  const moved = videoPlacement({...clip, scale: 2, x: 60}, asset, settings, settings)!;
  expect(moved.destination).toEqual({x: 0, y: 0, width: 320, height: 180});
  expect(moved.source.x).toBeCloseTo(64); expect(moved.source.width).toBeCloseTo(160);
  const portrait = videoPlacement(clip, {...asset, width: 90, height: 180}, settings, settings)!;
  expect(portrait.destination).toEqual({x: 115, y: 0, width: 90, height: 180});
});

it('keeps compatible cut frames on their original hardware device and excludes edited or padded frames', () => {
  const segment = {start: 0, duration: 15, sourceStart: 0, volume: 1, asset, placement: videoPlacement(clip, asset, settings, settings)};
  expect(canKeepHardwareFrames(segment, settings, false)).toBe(true);
  expect(canKeepHardwareFrames(segment, settings, true)).toBe(false);
  expect(canKeepHardwareFrames(segment, settings, false, 'lut3d=grade.cube')).toBe(false);
  expect(canKeepHardwareFrames({...segment, duration: 31}, settings, false)).toBe(false);
  expect(canKeepHardwareFrames({...segment, placement: videoPlacement({...clip, scale: 1.1}, asset, settings, settings)}, settings, false)).toBe(false);
  const encoder = {vendor: 'amd' as const, backend: 'vaapi' as const, name: 'h264_vaapi', binary: 'ffmpeg', label: 'AMD', device: '/dev/dri/renderD128'};
  const args = hardwareEncodingArguments(segmentArguments({segment, settings, source: 'input.mp4', hasAudio: false, output: 'output.nut', audioSamples: 0,
    decoder: {input: ['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi'], filter: 'hwdownload,format=nv12'}, hardwareFrames: true}), encoder, settings, true);
  expect(args).toContain('h264_vaapi'); expect(args).not.toContain('-pix_fmt');
  const graph = args[args.indexOf('-filter_complex') + 1];
  expect(graph).not.toMatch(/hwdownload|hwupload|scale|tpad/);
  expect(graph).toContain('fps=30:start_time=0'); expect(graph).toContain('trim=end_frame=15');
});

it('does not label a software or partially disabled browser as hardware accelerated', () => {
  const features = {gpu_compositing: 'enabled', rasterization: 'enabled'};
  expect(hardwareBrowserStatus({gpu: {auxAttributes: {glRenderer: 'ANGLE (AMD Radeon RX 9070 XT)'}, featureStatus: features}}).accelerated).toBe(true);
  expect(hardwareBrowserStatus({gpu: {auxAttributes: {glRenderer: 'ANGLE (SwiftShader)'}, featureStatus: features}}).accelerated).toBe(false);
  expect(hardwareBrowserStatus({gpu: {auxAttributes: {glRenderer: 'AMD'}, featureStatus: {...features, rasterization: 'disabled_software'}}}).accelerated).toBe(false);
});
