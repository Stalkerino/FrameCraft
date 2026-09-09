import {z} from 'zod';
import type {RoughCutProposal} from './assisted-editing';

export const transcriptWordSchema = z.object({id: z.string().min(1), text: z.string().max(300), start: z.number().finite().nonnegative(), end: z.number().finite().positive()}).refine(word => word.end > word.start, 'Word end must follow its start');
export const transcriptSchema = z.object({assetId: z.string().min(1), revision: z.number().int().nonnegative(), language: z.string(), model: z.string(), updatedAt: z.string(), words: z.array(transcriptWordSchema).max(100_000)});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export interface TranscriptSegment {id: string; assetId: string; start: number; end: number; text: string; wordIds: string[]}
export interface SearchHit extends TranscriptSegment {assetName: string; score: number; match: 'transcript' | 'filename'}
export interface AnalysisJob {id: string; kind: 'transcription' | 'search' | 'roughcut' | 'dictation' | 'visual-scan'; assetId?: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; progress: number; message: string; error?: string; results?: SearchHit[]; proposal?: RoughCutProposal; text?: string; reportId?: string}

export function transcriptSegments(transcript: Transcript): TranscriptSegment[] {
  const result: TranscriptSegment[] = []; let words: TranscriptWord[] = [];
  const flush = () => {
    if(!words.length) return;
    result.push({id: words[0].id, assetId: transcript.assetId, start: words[0].start, end: words.at(-1)!.end, text: words.map(w => w.text.trim()).filter(Boolean).join(' '), wordIds: words.map(w => w.id)}); words = [];
  };
  for(const word of transcript.words) {
    if(words.length && (word.start - words.at(-1)!.end > .8 || word.end - words[0].start > 7 || words.map(w => w.text).join(' ').length + word.text.length > 110)) flush();
    words.push(word); if(/[.!?]["'»]?\s*$/.test(word.text)) flush();
  }
  flush(); return result;
}

export function validateTranscript(transcript: Transcript, duration: number) {
  transcriptSchema.parse(transcript); let end = 0; const ids = new Set<string>();
  for(const word of transcript.words) {
    if(ids.has(word.id)) throw new Error('Duplicate transcript word ID'); ids.add(word.id);
    if(word.start < end - .001 || word.end > duration + .05) throw new Error('Transcript timing is outside the media or overlaps');
    end = word.end;
  }
  return transcript;
}

export function normalizeWords(chunks: {text: string; timestamp: [number | null, number | null]}[], duration: number, id: () => string): TranscriptWord[] {
  const words: TranscriptWord[] = []; let previous = 0;
  for(let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]; const text = chunk.text.trim();
    const start = Math.max(previous, chunk.timestamp[0] ?? previous);
    const end = Math.min(duration, chunk.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? duration);
    if(!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    words.push({id: id(), text, start, end}); previous = end;
  }
  return words;
}
