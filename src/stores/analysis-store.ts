import {create} from 'zustand';
import type {AnalysisJob} from '../../shared/transcript';
import {analysisApi} from '../services/analysis-api';
export const useAnalysis = create<{jobs: AnalysisJob[]; tab: 'gameplay' | 'speech' | 'search' | 'cut' | 'overlays'; assetId: string; searchId: string | null; roughcutId: string | null; add: (job: AnalysisJob) => void}>(set => ({
  jobs: [], tab: 'speech', assetId: '', searchId: null, roughcutId: null,
  add: job => set(state => ({jobs: [...state.jobs.filter(j => j.id !== job.id), job]})),
}));
export function connectAnalysis() {
  let stopped = false; let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {try {const jobs = await analysisApi.jobs(); if(!stopped) useAnalysis.setState({jobs});} catch {/* Retain job state during reconnection. */} finally {if(!stopped) timer = setTimeout(poll, 1500);}};
  void poll(); return () => {stopped = true; clearTimeout(timer);};
}
