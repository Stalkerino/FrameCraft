import {useEffect,useRef,useState} from 'react';
import type {AutoAudioApply,AutoAudioSettings} from '../../shared/auto-audio';
import {timelineIdentity} from '../../shared/project-sequences';
import {useAutoAudioReports} from '../stores/auto-audio-store';
import {useEditor} from '../stores/editor-store';
import {autoAudioApi} from '../services/auto-audio-api';
export function useAutoAudio() {
  const project=useEditor(s=>s.snapshot?.project),key=project?timelineIdentity(project):'';
  const report=useAutoAudioReports(s=>s.reports[key]);const [pending,setPending]=useState(false);const [error,setError]=useState('');const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const running=!!report&&['queued','analyzing'].includes(report.status);
  useEffect(()=>{
    if(!running||!report)return;let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await autoAudioApi.report(report.id);if(disposed)return;useAutoAudioReports.getState().remember(key,next);if(['queued','analyzing'].includes(next.status))timer=setTimeout(poll,600);}catch(e){if(!disposed)setError((e as Error).message);}};
    timer=setTimeout(poll,200);return()=>{disposed=true;clearTimeout(timer);};
  },[report?.id,running,key]);
  const run=async(work:()=>Promise<void>)=>{if(pending)return;setPending(true);setError('');try{await work();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setPending(false);}};
  const analyze=(settings:Omit<AutoAudioSettings,'revision'>)=>run(async()=>{
    const current=useEditor.getState().snapshot?.project;if(!current||timelineIdentity(current)!==key)return;useEditor.setState({playing:false});
    useAutoAudioReports.getState().remember(key,await autoAudioApi.analyze({...settings,revision:current.revision}));
  });
  const apply=(input:Omit<AutoAudioApply,'reportId'|'revision'>)=>run(async()=>{
    if(!report)return;const snapshot=await autoAudioApi.apply({...input,reportId:report.id,revision:report.revision});
    const current=useEditor.getState().snapshot?.project;if(current&&timelineIdentity(current)===key)useEditor.getState().accept(snapshot);
    useAutoAudioReports.getState().remember(key,{...report,appliedRevision:snapshot.project.revision});
  });
  const cancel=()=>run(async()=>{if(report)useAutoAudioReports.getState().remember(key,await autoAudioApi.cancel(report.id));});
  return {report,running,pending,error:error||report?.error,analyze,apply,cancel,stale:!!report&&report.revision!==project?.revision};
}
