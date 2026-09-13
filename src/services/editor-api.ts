import type {ExportSettings} from '../../shared/media-settings';
import type {EncoderCapabilities} from '../../shared/encoding';
import type {Command, RenderJob, Snapshot} from '../../shared/project';
import type {RenderPlan, RenderPlanRequest} from '../../shared/render-plan';
export interface ServerStatus {agentLastSeen: string | null; agentConnections: {id: string; clientName: string; connectedAt: string; lastSeen: string}[]; editorContext: {frame: number; selectedId: string | null; selectedTrackId: string | null}; platform: string; projectPath: string; rootDir: string}
export async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {signal, ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})});
  const result = await response.json(); if(!response.ok) throw Object.assign(new Error(result.error || 'The local service could not complete this action'), {status: response.status});
  return result;
}
export const editorApi = {
  snapshot: () => request<Snapshot>('/api/project'),
  execute: (commands: Command[], revision: number, label: string) => request<Snapshot>('/api/commands', {commands, revision, label}),
  history: (direction: 'undo' | 'redo', revision: number) => request<Snapshot>(`/api/history/${direction}`, {revision}),
  status: () => request<ServerStatus>('/api/status'),
  context: (frame: number, selectedId: string | null, selectedTrackId?: string | null, projectId?: string, sequenceId?: string) => request('/api/context', {frame, selectedId, selectedTrackId, projectId, sequenceId}),
  render: (kind: 'video' | 'frame', frame?: number, settings?: ExportSettings, revision?: number, outputPath?: string) => request<RenderJob>('/api/render', {kind, frame, settings, revision, outputPath}),
  job: (id: string) => request<RenderJob>(`/api/render/${id}`),
  encoders: (codec: ExportSettings['codec'], renderer: ExportSettings['renderer'] = 'compatible') => request<EncoderCapabilities>(`/api/render/encoders?codec=${encodeURIComponent(codec)}&renderer=${encodeURIComponent(renderer)}`),
  renderPlan: (input: RenderPlanRequest, signal?: AbortSignal) => request<RenderPlan>('/api/render/plan', input, signal),
  async import(file: File, projectId?: string, folderId?: string) {
    const body = new FormData(); body.append('file', file);
    const query = new URLSearchParams(); if(projectId) query.set('projectId', projectId); if(folderId) query.set('folderId', folderId);
    const response = await fetch(`/api/import?${query}`, {method: 'POST', body}); const result = await response.json();
    if(!response.ok) throw new Error(result.error || 'Import failed'); return result as Snapshot;
  },
};
