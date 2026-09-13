import {create} from 'zustand';
import type {AutoAudioReport} from '../../shared/auto-audio';
export const useAutoAudioReports=create<{reports:Record<string,AutoAudioReport>;remember:(key:string,report:AutoAudioReport)=>void}>(set=>({reports:{},remember:(key,report)=>set(state=>({reports:{...state.reports,[key]:report}}))}));
