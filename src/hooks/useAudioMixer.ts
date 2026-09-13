import {useEffect,useRef,useState} from 'react';
import type {MasterMix,TrackMix,AudioMixJob} from '../../shared/audio-mixer';
import {audioMixerApi} from '../services/audio-mixer-api';
import {useEditor} from '../stores/editor-store';
export function useAudioMixer() {
  const [pending,setPending]=useState(false);const [error,setError]=useState('');const [measurement,setMeasurement]=useState<AudioMixJob>();
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const run=async(work:()=>Promise<void>)=>{if(pending)return;setPending(true);setError('');try{await work();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setPending(false);}};
  const set=(change:{tracks?:{id:string;mix?:TrackMix|null;muted?:boolean}[];master?:MasterMix|null})=>run(async()=>{
    const project=useEditor.getState().snapshot?.project;if(!project)return;
    const result=await audioMixerApi.set({revision:project.revision,...change});
    if(useEditor.getState().snapshot?.project.id===project.id)useEditor.getState().accept(result);
  });
  const measure=()=>run(async()=>{const project=useEditor.getState().snapshot?.project;if(project){useEditor.setState({playing:false});const job=await audioMixerApi.prepare(project.revision,true);if(alive.current)setMeasurement(job);}});
  useEffect(()=>{
    if(!measurement||!['queued','processing'].includes(measurement.status))return;
    let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const job=await audioMixerApi.job(measurement.id);if(disposed)return;setMeasurement(job);if(job.error)setError(job.error);if(['queued','processing'].includes(job.status))timer=setTimeout(poll,500);}catch(e){if(!disposed)setError((e as Error).message);}};
    timer=setTimeout(poll,500);return()=>{disposed=true;clearTimeout(timer);};
  },[measurement?.id,measurement?.status]);
  return {set,measure,measurement,pending,error,cancel:()=>run(async()=>{if(measurement){const job=await audioMixerApi.cancel(measurement.id);if(alive.current)setMeasurement(job);}})};
}
