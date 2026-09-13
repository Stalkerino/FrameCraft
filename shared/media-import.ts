export const previewQualities = ['high', 'proxy-1080', 'performance', 'proxy-360'] as const;
export type PreviewQuality = typeof previewQualities[number];
export const previewProfiles = {
  high: {label: 'Original / full resolution', width: 0, height: 0},
  'proxy-1080': {label: 'Proxy · 1080p', width: 1920, height: 1080},
  performance: {label: 'Proxy · 720p', width: 1280, height: 720},
  'proxy-360': {label: 'Proxy · 360p', width: 640, height: 360},
} as const;
export const mediaPreviewKey = (assetId: string, quality: PreviewQuality) => quality === 'performance' ? assetId : `${assetId}:${quality}`;

export interface MediaPreview {
  assetId: string;
  quality?: PreviewQuality;
  src?: string;
  width?: number;
  height?: number;
  status: 'idle' | 'queued' | 'running' | 'ready' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  encoding?: string;
  warning?: string;
}
export type MediaPreviews = Record<string, MediaPreview>;
