import type {MediaPreview, PreviewQuality} from '../../shared/media-import';
import {request} from './editor-api';
import {subscribeWorkspace} from './workspace-events';

export const mediaApi = {
  action: (assetId: string, action: 'cancel' | 'retry' | 'ensure', quality: PreviewQuality = 'high') => request<MediaPreview>(`/api/media/${encodeURIComponent(assetId)}/preview`, {action, quality}),
  subscribe: (receive: Parameters<typeof subscribeWorkspace<'media'>>[1]) => subscribeWorkspace('media', receive, () => undefined),
};
