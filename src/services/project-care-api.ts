import type {Snapshot} from '../../shared/project';
import type {MediaHealth, ProjectTransferJob, RecoveryVersion} from '../../shared/project-care';
import {request} from './editor-api';
const base = '/api/project-care';
export const projectCareApi = {
  versions: () => request<RecoveryVersion[]>(`${base}/versions`),
  checkpoint: (revision: number, label: string) => request<RecoveryVersion>(`${base}/versions`, {revision, label}),
  restore: (revision: number, id: string) => request<Snapshot>(`${base}/restore`, {revision, id}),
  media: () => request<MediaHealth>(`${base}/media`),
  relink: (revision: number, assetId: string, filePath: string) => request<Snapshot>(`${base}/relink`, {revision, assetId, filePath}),
  transfers: () => request<ProjectTransferJob[]>(`${base}/transfers`),
  package: (revision: number, directory: string) => request<ProjectTransferJob>(`${base}/package`, {revision, directory}),
  import: (directory: string) => request<ProjectTransferJob>(`${base}/import-package`, {directory}),
  cancel: (id: string) => request<ProjectTransferJob>(`${base}/transfers/${encodeURIComponent(id)}/cancel`, {}),
};
