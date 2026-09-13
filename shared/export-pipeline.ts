import {defaultExportSettings, type ExportSettings} from './media-settings';

/** The ordinary GPU choice means the complete native video pipeline. Browser
 * composition with GPU encoding remains an explicit compatibility choice. */
export function selectExportEncoder(settings: ExportSettings, encoder: ExportSettings['encoder']): Partial<ExportSettings> {
  const renderer = encoder === 'amd' || encoder === 'nvidia'
    ? settings.renderer === 'compatible' ? 'native-vulkan' : settings.renderer
    : 'compatible';
  return {encoder, ...selectExportRenderer({...settings, encoder}, renderer)};
}
export function selectExportRenderer(settings: ExportSettings, renderer: ExportSettings['renderer']): Partial<ExportSettings> {
  return {renderer, ...(renderer !== 'compatible' ? {
    encoder: settings.encoder === 'amd' || settings.encoder === 'nvidia' ? settings.encoder : 'amd',
    ...(!['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec) ? {codec: 'h264', audioCodec: 'aac', crf: Math.min(51, Math.max(1, settings.crf))} as const : {}),
  } : {})};
}
export function initialExportPipeline(project: Parameters<typeof defaultExportSettings>[0], preference?: {renderer: ExportSettings['renderer']; encoder: ExportSettings['encoder']}): ExportSettings {
  const settings = defaultExportSettings(project);
  if(preference) return {...settings, encoder: preference.encoder, ...selectExportRenderer({...settings, encoder: preference.encoder}, preference.renderer)};
  // Existing projects often saved a GPU encoder before native composition
  // existed. Upgrade the dialog choice, without rewriting the saved project.
  return settings.renderer === 'compatible' && (settings.encoder === 'amd' || settings.encoder === 'nvidia')
    ? {...settings, ...selectExportEncoder(settings, settings.encoder)} : settings;
}
