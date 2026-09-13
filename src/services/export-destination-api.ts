import type {ExportSettings} from '../../shared/media-settings';
import {request} from './editor-api';
export const exportDestinationApi = {
  defaults: (codec: ExportSettings['codec']) => request<{projectId: string; outputPath: string}>(`/api/render/destination?codec=${encodeURIComponent(codec)}`),
};
