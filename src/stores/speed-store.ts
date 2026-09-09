import {create} from 'zustand';
import type {SpeedJob} from '../../shared/speed-ramping';

export const useSpeedJobs = create<{jobs: Record<string, SpeedJob>; remember: (key: string, job: SpeedJob) => void}>(set => ({
  jobs: {}, remember: (key, job) => set(state => ({jobs: {...state.jobs, [key]: job}})),
}));
