import type {AutoAudioApply,AutoAudioReport,AutoAudioSettings} from '../../shared/auto-audio';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
export const autoAudioApi={
  analyze:(input:AutoAudioSettings)=>request<AutoAudioReport>('/api/auto-audio/analyze',input),
  report:(id:string)=>request<AutoAudioReport>(`/api/auto-audio/reports/${encodeURIComponent(id)}`),
  cancel:(id:string)=>request<AutoAudioReport>(`/api/auto-audio/reports/${encodeURIComponent(id)}/cancel`,{}),
  apply:(input:AutoAudioApply)=>request<Snapshot>('/api/auto-audio/apply',input),
};
