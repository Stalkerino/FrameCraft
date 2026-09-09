import {create} from 'zustand';
import type {AudioEffectJob} from '../../shared/audio-effects';

// Keep actual job state when the user changes selection or opens Codex.
export const useAudioJobs = create<{jobs: Record<string, AudioEffectJob>; remember: (key: string, job: AudioEffectJob) => void}>(set => ({
  jobs: {}, remember: (key, job) => set(state => ({jobs: {...state.jobs, [key]: job}})),
}));
