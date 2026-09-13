import {z} from 'zod';
export const dimensionSchema = z.number().int().min(64).max(8192).multipleOf(2);
export const fpsSchema = z.number().finite().min(1).max(120);
export const canvasSettingsSchema = z.object({width: dimensionSchema, height: dimensionSchema, fps: fpsSchema, backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#080c0e'), masterVolume: z.number().min(0).max(1).default(1)});
export type CanvasSettings = z.infer<typeof canvasSettingsSchema>;
export const codecNames = ['h264', 'h265', 'vp8', 'vp9', 'av1', 'prores', 'h264-mkv'] as const;
export const exportSettingsSchema = z.object({
  width: dimensionSchema, height: dimensionSchema, fps: fpsSchema,
  codec: z.enum(codecNames).default('h264'), fit: z.enum(['contain', 'cover', 'stretch']).default('contain'),
  encoder: z.enum(['auto', 'cpu', 'amd', 'nvidia']).default('auto'),
  renderer: z.enum(['compatible', 'native-gpu', 'native-vulkan']).default('compatible').describe('compatible preserves all effects. native-gpu handles full-canvas cuts. native-vulkan adds static multitrack composition, crop, placement and canvas backgrounds through Vulkan Video. Native modes require GPU video stages; unsupported operations fail without CPU/browser fallback.'),
  qualityMode: z.enum(['quality', 'bitrate']).default('quality'), crf: z.number().int().min(0).max(63).default(16), videoBitrate: z.number().min(.1).max(500).default(32),
  preset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow']).default('medium'),
  proResProfile: z.enum(['proxy', 'light', 'standard', 'hq', '4444', '4444-xq']).default('hq'),
  audio: z.boolean().default(true), audioCodec: z.enum(['aac', 'opus', 'pcm-16']).default('aac'), audioBitrate: z.number().int().min(32).max(512).default(192), sampleRate: z.union([z.literal(44100), z.literal(48000)]).default(48000),
  startSeconds: z.number().finite().nonnegative().default(0), endSeconds: z.number().finite().positive().optional(),
}).superRefine((settings, context) => {
  const issue = (path: string, message: string) => context.addIssue({code: z.ZodIssueCode.custom, path: [path], message});
  if(settings.renderer !== 'compatible' && settings.encoder !== 'amd' && settings.encoder !== 'nvidia') issue('encoder', 'Choose AMD or NVIDIA for native GPU rendering.');
  if(settings.renderer !== 'compatible' && !['h264', 'h264-mkv', 'h265', 'av1'].includes(settings.codec)) issue('codec', 'Native GPU rendering requires H.264, H.265 or AV1.');
  if(settings.qualityMode === 'quality' && ['h264', 'h265', 'h264-mkv'].includes(settings.codec) && settings.crf > 51) issue('crf', 'H.264 and H.265 quality must be between 0 and 51');
  if(settings.qualityMode === 'quality' && ['h264', 'h264-mkv'].includes(settings.codec) && settings.crf < 1) issue('crf', 'H.264 CRF must be at least 1');
  if(settings.qualityMode === 'quality' && settings.codec === 'vp8' && settings.crf < 4) issue('crf', 'VP8 CRF must be at least 4');
  if(settings.audio && !audioCodecsFor(settings.codec).includes(settings.audioCodec)) issue('audioCodec', 'Choose an audio codec supported by this container');
  if(settings.endSeconds !== undefined && settings.endSeconds <= settings.startSeconds) issue('endSeconds', 'Export end must follow its start');
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const extensionFor = (codec: ExportSettings['codec']) => codec === 'prores' ? 'mov' : codec === 'vp8' || codec === 'vp9' ? 'webm' : codec === 'h264-mkv' ? 'mkv' : 'mp4';
export function audioCodecsFor(codec: ExportSettings['codec']): ExportSettings['audioCodec'][] {return codec === 'vp8' || codec === 'vp9' ? ['opus'] : codec === 'prores' ? ['pcm-16', 'aac'] : codec === 'h264-mkv' ? ['pcm-16'] : ['aac'];}
/** A starting point for high-motion footage, not a guarantee of file size or quality. */
export function recommendedVideoBitrate(settings: {width: number; height: number; fps: number; codec?: ExportSettings['codec']}) {
  const efficiency = settings.codec === 'h265' || settings.codec === 'vp9' ? .7 : settings.codec === 'av1' ? .6 : 1;
  return Math.min(500, Math.max(2, Math.round(settings.width * settings.height * settings.fps * .26 * efficiency / 1_000_000)));
}
// Explicit saved export choices survive upgrades. Only new settings adopt defaults.
export const defaultExportSettings = (project: {width: number; height: number; fps: number; exportSettings?: ExportSettings}): ExportSettings => exportSettingsSchema.parse(project.exportSettings ?? {width: project.width, height: project.height, fps: project.fps, videoBitrate: recommendedVideoBitrate(project)});
export const resolutionPresets = [{label: 'HD · 720p', width: 1280, height: 720}, {label: 'Full HD · 1080p', width: 1920, height: 1080}, {label: 'QHD · 1440p', width: 2560, height: 1440}, {label: 'UHD · 4K', width: 3840, height: 2160}, {label: 'UHD · 8K', width: 7680, height: 4320}, {label: 'Vertical · 1080 × 1920', width: 1080, height: 1920}, {label: 'Square · 1080 × 1080', width: 1080, height: 1080}] as const;
export const frameRatePresets = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
