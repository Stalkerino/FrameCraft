import type {z} from 'zod';
import type {AnalysisJob} from '../../shared/transcript';
import type {Snapshot} from '../../shared/project';
import type {applyVideoCutSchema, VideoCut, VideoInspection, VideoSheet, VisualReport} from '../../shared/visual-rush';
import {request} from './editor-api';
const base = '/api/visual-rush';
export const visualRushApi = {
  list: () => request<{reports: VisualReport[]; cuts: VideoCut[]}>(base),
  analyze: (assetId: string, refresh = false) => request<AnalysisJob>(`${base}/analyze`, {assetId, refresh}),
  inspect: (input: VideoInspection) => request<VideoSheet>(`${base}/inspect`, input),
  apply: (input: z.infer<typeof applyVideoCutSchema>) => request<Snapshot>(`${base}/apply`, input),
};
