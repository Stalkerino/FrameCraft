import type {z} from 'zod';
import type {AudioMixJob,setAudioMixerSchema} from '../../shared/audio-mixer';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
export const audioMixerApi={
  set:(input:z.infer<typeof setAudioMixerSchema>)=>request<Snapshot>('/api/audio/mixer',input),
  prepare:(revision:number,measure=false)=>request<AudioMixJob>('/api/audio/mixes',{revision,measure}),
  job:(id:string)=>request<AudioMixJob>(`/api/audio/mixes/${encodeURIComponent(id)}`),
  cancel:(id:string)=>request<AudioMixJob>(`/api/audio/mixes/${encodeURIComponent(id)}/cancel`,{}),
};
