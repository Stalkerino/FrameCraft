import {useCallback,useEffect,useMemo,useState} from 'react';
import type {Project} from '../../shared/project';
import {audioMixIdentity,needsAudioMix} from '../../shared/audio-mixer';
import {audioMixerApi} from '../services/audio-mixer-api';
import {useEditor} from '../stores/editor-store';

export function useAudioMixPreview(project?:Project) {
  const key=useMemo(()=>project&&needsAudioMix(project)?audioMixIdentity(project):'',[project]);
  const [state,setState]=useState<{key:string;url?:string;error?:string}>({key:''});
  const [attempt,retry]=useState(0);
  useEffect(()=>{
    if(!key)return;
    let disposed=false;let timer:ReturnType<typeof setTimeout>;let jobId:string|undefined;
    useEditor.setState({playing:false});setState({key});
    const poll=async()=>{
      try{
        const current=useEditor.getState().snapshot?.project;if(!current||audioMixIdentity(current)!==key)return;
        const job=jobId?await audioMixerApi.job(jobId):await audioMixerApi.prepare(current.revision);if(disposed)return;jobId=job.id;
        if(job.status==='done'){setState({key,url:job.url});return;}
        if(job.status==='error'||job.status==='cancelled')throw new Error(job.error||'Audio preparation was cancelled.');
        timer=setTimeout(poll,400);
      }catch(error){if(!disposed)setState({key,error:(error as Error).message});}
    };
    // Commit-driven edits can arrive in a batch; do not render every keystroke.
    timer=setTimeout(()=>void poll(),250);
    return()=>{disposed=true;clearTimeout(timer);};
  },[key,attempt]);
  const result=state.key===key?state:undefined;
  const blocked=!!key&&!result?.url;
  useEffect(()=>{if(!blocked)return;useEditor.setState({playing:false});return useEditor.subscribe(state=>{if(state.playing)useEditor.setState({playing:false});});},[blocked]);
  const fail=useCallback((error:Error)=>{setState({key,error:`Audio mix playback failed: ${error.message}`});},[key]);
  return {enabled:!!key,url:key?result?.url:undefined,error:key?result?.error:undefined,pending:!!key&&!result?.url&&!result?.error,retry:()=>retry(n=>n+1),fail};
}
