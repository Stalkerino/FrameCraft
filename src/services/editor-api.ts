import type {ExportSettings} from '../../shared/media-settings';
import type {EncoderCapabilities} from '../../shared/encoding';
import type {Command, RenderJob, Snapshot} from '../../shared/project';
export interface ServerStatus {agentLastSeen: string | null; agentConnections: {id: string; clientName: string; connectedAt: string; lastSeen: string}[]; editorContext: {frame: number; selectedId: string | null; selectedTrackId: string | null}; platform: string; projectPath: string; rootDir: string}
export async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json(); if(!response.ok) throw Object.assign(new Error(result.error || 'The local service could not complete this action'), {status: response.status});
  return result;
}
export const editorApi = {
  snapshot: () => request<Snapshot>('/api/project'),
  execute: (commands: Command[], revision: number, label: string) => request<Snapshot>('/api/commands', {commands, revision, label}),
  history: (direction: 'undo' | 'redo', revision: number) => request<Snapshot>(`/api/history/${direction}`, {revision}),
  status: () => request<ServerStatus>('/api/status'),
  context: (frame: number, selectedId: string | null, selectedTrackId?: string | null, projectId?: string) => request('/api/context', {frame, selectedId, selectedTrackId, projectId}),
  render: (kind: 'video' | 'frame', frame?: number, settings?: ExportSettings, revision?: number) => request<RenderJob>('/api/render', {kind, frame, settings, revision}),
  job: (id: string) => request<RenderJob>(`/api/render/${id}`),
  encoders: (codec: ExportSettings['codec']) => request<EncoderCapabilities>(`/api/render/encoders?codec=${encodeURIComponent(codec)}`),
  async import(file: File, projectId?: string) {
    const body = new FormData(); body.append('file', file);
    const response = await fetch(`/api/import${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {method: 'POST', body}); const result = await response.json();
    if(!response.ok) throw new Error(result.error || 'Import failed'); return result as Snapshot;
  },
};
