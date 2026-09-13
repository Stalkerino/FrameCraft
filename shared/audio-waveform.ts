export interface AudioWaveform {version: 1; secondsPerBin: number; peaks: number[]; rms: number[]; duration: number}
export interface WaveformResult {status: 'queued' | 'running' | 'ready' | 'error'; waveform?: AudioWaveform; error?: string}
