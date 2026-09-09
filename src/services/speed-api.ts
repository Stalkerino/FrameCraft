import type {z} from 'zod';
import type {applySpeedSchema, resetSpeedSchema, SpeedJob} from '../../shared/speed-ramping';
import {request} from './editor-api';
export const speedApi = {
  apply: (input: z.input<typeof applySpeedSchema>) => request<SpeedJob>('/api/speed/apply', input),
  reset: (input: z.input<typeof resetSpeedSchema>) => request<SpeedJob>('/api/speed/reset', input),
  job: (id: string) => request<SpeedJob>(`/api/speed/jobs/${encodeURIComponent(id)}`),
  cancel: (id: string) => request<SpeedJob>(`/api/speed/jobs/${encodeURIComponent(id)}/cancel`, {}),
};
