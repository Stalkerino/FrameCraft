import type {Asset} from '../../shared/project';
import {mediaPreviewKey, type MediaPreviews, type PreviewQuality} from '../../shared/media-import';

export interface PlaybackSource {
  assetId: string;
  src?: string;
  mode: 'original' | PreviewQuality;
  width?: number;
  height?: number;
  status: 'ready' | 'idle' | 'queued' | 'running' | 'error' | 'cancelled';
  fallback?: boolean;
}
const supported = new Map<string, boolean>();
function supportsOriginal(asset: Asset) {
  if(!asset.previewSrc) return true;
  // MP4 HEVC may be decoded directly by the browser/OS. A decoder error still
  // triggers the compatibility path; a positive capability report is not a lock.
  if(!['hevc', 'h265'].includes(asset.videoCodec ?? '') || !/\.(mp4|m4v|mov)$/i.test(asset.src)) return false;
  const key = asset.videoCodec!;
  if(!supported.has(key)) supported.set(key, typeof document !== 'undefined' && !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L120.B0"'));
  return supported.get(key)!;
}
export function playbackSource(asset: Asset, quality: PreviewQuality, previews: MediaPreviews, rejected: Record<string, boolean>, native = false): PlaybackSource {
  if(asset.kind !== 'video' || quality === 'high' && (native || !rejected[asset.id] && supportsOriginal(asset))) return {assetId: asset.id, src: asset.src, mode: 'original', width: asset.width, height: asset.height, status: 'ready'};
  const preview = previews[mediaPreviewKey(asset.id, quality)];
  const src = preview?.src;
  if(preview?.status !== 'ready' && (native || !rejected[asset.id] && supportsOriginal(asset))) {
    return {assetId: asset.id, src: asset.src, mode: quality, width: asset.width, height: asset.height, status: preview?.status ?? 'idle', fallback: true};
  }
  return {assetId: asset.id, src: preview?.status === 'ready' ? src : native ? asset.src : undefined, mode: quality, width: preview?.width, height: preview?.height, status: preview?.status === 'ready' && !src ? 'idle' : preview?.status ?? 'idle'};
}
export function playbackSourceLabel(source?: PlaybackSource) {
  if(!source) return 'Full quality';
  if(source.fallback) return `Original · proxy ${source.status === 'error' ? 'failed' : source.status === 'cancelled' ? 'stopped' : 'preparing'}`;
  const label = source.mode === 'original' ? 'Original' : source.mode === 'high' ? 'Full resolution' : 'Proxy';
  return source.status === 'ready' ? `${label}${source.width && source.height ? ` · ${source.width} × ${source.height}` : ''}` : `${label} · ${source.status === 'error' ? 'failed' : source.status === 'cancelled' ? 'stopped' : 'preparing'}`;
}
