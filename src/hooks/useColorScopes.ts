import {useEffect,useRef,useState} from 'react';
import {colorApi,type ScopeCapture} from '../services/color-api';
import {useEditor} from '../stores/editor-store';
export function useColorScopes(){
  const [capture,setCapture]=useState<ScopeCapture|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(!capture||!['queued','rendering'].includes(capture.status))return;let cancelled=false;
    const timer=setInterval(()=>{void colorApi.scopes(capture.id).then(next=>{if(!cancelled){setCapture(next);if(next.status==='error'){setError(next.error??'Scope capture failed.');setBusy(false);}else if(next.status==='done')setBusy(false);}}).catch(error=>{if(!cancelled){setError(error.message);setBusy(false);setCapture(current=>current?{...current,status:'error'}:current);}});},700);
    return()=>{cancelled=true;clearInterval(timer);};
  },[capture?.id,capture?.status]);
  const analyze=async()=>{const state=useEditor.getState();const project=state.snapshot?.project;if(!project||busy)return;setBusy(true);setError('');useEditor.setState({playing:false});try{const job=await colorApi.capture(project.revision,state.frame);const next=await colorApi.scopes(job.id);if(alive.current){setCapture(next);if(next.status==='done'||next.status==='error'){setBusy(false);if(next.error)setError(next.error);}}}catch(error){if(alive.current){setError((error as Error).message);setBusy(false);}}};
  return {capture,busy,error,analyze};
}
