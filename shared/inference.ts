export type InferenceRequest =
  | {kind: 'transcription'; file: string; language: 'auto' | 'french' | 'english'; cacheDir: string}
  | {kind: 'embedding'; texts: string[]; cacheDir: string};
export interface InferenceResult {chunks?: {text: string; timestamp: [number | null, number | null]}[]; vectors?: number[][]; model: string}
export type InferenceMessage = {type: 'progress'; progress: number; message: string} | {type: 'result'; result: InferenceResult} | {type: 'error'; error: string};
