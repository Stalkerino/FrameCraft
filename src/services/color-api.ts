import type {ColorLut} from '../../shared/color-lut';
import type {ColorScopes} from '../../shared/color-scopes';
import type {Snapshot} from '../../shared/project';
import {request} from './editor-api';
export interface ScopeCapture {id:string;projectId:string;sequenceId:string;revision:number;frame:number;status:'queued'|'rendering'|'done'|'error';error?:string;url?:string;result?:ColorScopes}
export const colorApi={
  luts:()=>request<Omit<ColorLut,'data'>[]>('/api/color-grading/luts'),
  import:(text:string,name:string,revision:number)=>request<Snapshot&{lutId:string}>('/api/color-grading/luts/import',{text,name,revision}),
  attach:(id:string,revision:number)=>request<Snapshot>('/api/color-grading/luts/attach',{id,revision}),
  capture:(revision:number,frame:number)=>request<{id:string}>('/api/color-grading/scopes',{revision,frame}),
  scopes:(id:string)=>request<ScopeCapture>(`/api/color-grading/scopes/${id}`),
};
