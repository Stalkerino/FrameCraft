import {expect, it} from 'vitest';
import {defaultExportSettings, exportSettingsSchema, recommendedVideoBitrate} from '../shared/media-settings';
import {outputQualityNotices, sourceOutputSettings} from '../shared/output-quality';
import {hardwareEncodingArguments, type HardwareEncoder} from '../server/services/encoding-arguments';

it('uses detailed-video defaults while respecting explicitly saved export choices', () => {
  const canvas = {width: 3840, height: 2160, fps: 60};
  const defaults = defaultExportSettings(canvas);
  expect(defaults.crf).toBe(16);
  expect(defaults.videoBitrate).toBeGreaterThan(recommendedVideoBitrate({width: 1920, height: 1080, fps: 30}));
  const saved = exportSettingsSchema.parse({...canvas, width: 1280, height: 720, qualityMode: 'bitrate', videoBitrate: 8, crf: 22});
  expect(defaultExportSettings({...canvas, exportSettings: saved})).toEqual(saved);
});

it('matches known source frame rate, keeps legacy timing, and explains scaling losses', () => {
  const source = {id: 'source', name: 'Source', src: '/media/source.mp4', kind: 'video' as const, width: 2560, height: 1440, fps: 59.94, duration: 10};
  expect(sourceOutputSettings(source, 30)).toEqual({width: 2560, height: 1440, fps: 59.94});
  expect(sourceOutputSettings({...source, fps: undefined}, 30)?.fps).toBe(30);
  expect(outputQualityNotices(source, {width: 1920, height: 1080, fps: 30})).toHaveLength(2);
  expect(outputQualityNotices(source, {width: 3840, height: 2160, fps: 120}).join(' ')).toContain('does not create additional detail');
});

it('keeps constant quality uncapped by target bitrate on AMD and NVIDIA', () => {
  const settings = exportSettingsSchema.parse({width: 2560, height: 1440, fps: 60, qualityMode: 'quality', crf: 16, videoBitrate: 1, preset: 'slow'});
  const args = ['-i', 'frames', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-b:v', '1M', 'output.mp4'];
  const encoders: HardwareEncoder[] = [
    {vendor: 'amd', backend: 'vaapi', name: 'h264_vaapi', binary: 'ffmpeg', label: 'AMD', device: '/dev/dri/renderD128'},
    {vendor: 'amd', backend: 'amf', name: 'h264_amf', binary: 'ffmpeg.exe', label: 'AMD'},
    {vendor: 'nvidia', backend: 'nvenc', name: 'h264_nvenc', binary: 'ffmpeg.exe', label: 'NVIDIA'},
  ];
  for(const encoder of encoders) {
    const encoded = hardwareEncodingArguments(args, encoder, settings);
    expect(encoded).not.toContain('1M');
    expect(encoded).toContain('16');
    expect(hardwareEncodingArguments(['-c:v', 'copy', 'final.mp4'], encoder, settings)).toEqual(['-c:v', 'copy', 'final.mp4']);
    if(encoder.backend === 'nvenc') expect(encoded[encoded.indexOf('-preset') + 1]).toBe('p6');
    if(encoder.backend === 'amf') expect(encoded[encoded.indexOf('-quality') + 1]).toBe('quality');
  }
});
