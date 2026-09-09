import type {TimelineExportRequest, TimelineExportResult} from '../../shared/timeline-interchange';
import {request} from './editor-api';
export const timelineExportApi = {create: (input: TimelineExportRequest) => request<TimelineExportResult>('/api/timeline-export', input)};
