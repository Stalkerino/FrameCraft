import type {AudioEffectJob, AudioEffects} from '../../shared/audio-effects';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';

export interface DuckAudioInput {revision: number; targetClipIds: string[]; triggerTrackIds: string[]; gain: number; attackFrames: number; releaseFrames: number}
export const audioApi = {
  duck: (input: DuckAudioInput) => request<Snapshot>('/api/audio/duck', {...input, apply: true}),
  applyEffects: (revision: number, clipIds: string[], effects: AudioEffects) => request<AudioEffectJob>('/api/audio-effects/apply', {revision, clipIds, effects}),
  effectJob: (id: string) => request<AudioEffectJob>(`/api/audio-effects/jobs/${encodeURIComponent(id)}`),
  cancelEffects: (id: string) => request<AudioEffectJob>(`/api/audio-effects/jobs/${encodeURIComponent(id)}/cancel`, {}),
};
