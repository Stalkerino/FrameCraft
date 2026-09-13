import {expect, it} from 'vitest';
import {defaultExportSettings, exportSettingsSchema} from '../shared/media-settings';
import {initialExportPipeline, selectExportEncoder, selectExportRenderer} from '../shared/export-pipeline';
const settings = exportSettingsSchema.parse({width: 1920, height: 1080, fps: 30});
it('selects native Vulkan video stages when AMD or NVIDIA is chosen, not browser composition', () => {
  for(const encoder of ['amd', 'nvidia'] as const) expect(selectExportEncoder(settings, encoder)).toMatchObject({encoder, renderer: 'native-vulkan'});
  expect(selectExportEncoder({...settings, renderer: 'native-vulkan', encoder: 'amd'}, 'cpu')).toMatchObject({encoder: 'cpu', renderer: 'compatible'});
});
it('upgrades old GPU encoder presets in the export dialog without mutating the saved preset', () => {
  const saved = {...settings, encoder: 'amd' as const};
  expect(initialExportPipeline({...settings, exportSettings: saved})).toMatchObject({renderer: 'native-vulkan', encoder: 'amd'});
  expect(saved.renderer).toBe('compatible');
  expect(initialExportPipeline(settings)).toEqual(defaultExportSettings(settings));
});
it('retains an explicit browser choice and reuses a chosen native preview GPU', () => {
  const project = {...settings, exportSettings: {...settings, encoder: 'amd' as const}};
  expect(initialExportPipeline(project, {renderer: 'compatible', encoder: 'amd'})).toMatchObject({renderer: 'compatible', encoder: 'amd'});
  expect(initialExportPipeline(settings, {renderer: 'native-vulkan', encoder: 'nvidia'})).toMatchObject({renderer: 'native-vulkan', encoder: 'nvidia'});
  expect(selectExportRenderer({...settings, codec: 'prores'}, 'native-vulkan')).toMatchObject({renderer: 'native-vulkan', codec: 'h264', audioCodec: 'aac'});
});
