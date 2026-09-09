export type PreviewQuality = 'high' | 'performance';
export const mediaPreviewKey = (assetId: string, quality: PreviewQuality) => quality === 'high' ? `${assetId}:high` : assetId;

export interface MediaPreview {
  assetId: string;
  quality?: PreviewQuality;
  src?: string;
  width?: number;
  height?: number;
  status: 'idle' | 'queued' | 'running' | 'ready' | 'error' | 'cancelled';
  progress: number;
  error?: string;
}
export type MediaPreviews = Record<string, MediaPreview>;
