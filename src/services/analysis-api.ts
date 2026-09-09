import type {AnalysisJob, Transcript} from '../../shared/transcript';
import type {CaptionOptions, RoughCutShot} from '../../shared/assisted-editing';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
const base = '/api/analysis';
export interface CutPreview {ranges: {start: number; end: number}[]; removedFrames: number; affectedClips: number}
export interface CutInput {revision: number; transcriptRevision: number; clipId: string; wordIds: string[]}
export const analysisApi = {
  transcript: (id: string) => request<Transcript | null>(`${base}/transcripts/${encodeURIComponent(id)}`),
  saveTranscript: (doc: Transcript) => request<Transcript>(`${base}/transcripts/${encodeURIComponent(doc.assetId)}`, {revision: doc.revision, words: doc.words, language: doc.language}),
  transcribe: (assetId: string, language: string, revision: number | null) => request<AnalysisJob>(`${base}/transcribe`, {assetId, language, revision}),
  jobs: () => request<AnalysisJob[]>(`${base}/jobs`),
  cancel: (id: string) => request<AnalysisJob>(`${base}/jobs/${id}/cancel`, {}),
  search: (query: string) => request<AnalysisJob>(`${base}/search`, {query}),
  previewCut: (input: CutInput) => request<CutPreview>(`${base}/cut`, input),
  applyCut: (input: CutInput) => request<Snapshot>(`${base}/cut`, {...input, apply: true}),
  captions: (revision: number, transcriptRevision: number, clipId: string, options: Partial<CaptionOptions>) => request<Snapshot>(`${base}/captions`, {revision, transcriptRevision, clipId, options}),
  roughcut: (assetIds: string[], seconds: number, topic: string) => request<AnalysisJob>(`${base}/roughcut`, {assetIds, seconds, topic}),
  applyRoughcut: (revision: number, mode: 'append' | 'replace', shots: RoughCutShot[], title: string, addTitle: boolean) => request<Snapshot>(`${base}/roughcut/apply`, {revision, mode, shots, title, addTitle}),
};
