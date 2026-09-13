import {useEffect,useState} from 'react';
import type {ColorLut} from '../../shared/color-lut';
import {colorApi} from '../services/color-api';
import {useEditor} from '../stores/editor-store';
export function useColorLibrary(){
  const [library,setLibrary]=useState<Omit<ColorLut,'data'>[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const refresh=()=>colorApi.luts().then(setLibrary).catch(error=>setError(error.message));
  useEffect(()=>{void refresh();},[]);
  const run=async(operation:(revision:number)=>Promise<import('../../shared/project').Snapshot>)=>{const state=useEditor.getState();const project=state.snapshot?.project;if(!project||state.busy||busy)return;setBusy(true);setError('');try{const snapshot=await operation(project.revision);if(useEditor.getState().snapshot?.project.id===project.id)useEditor.getState().accept(snapshot);await refresh();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
  return {library,busy,error,importFile:(file:File)=>run(async revision=>{if(file.size>20_000_000)throw new Error('Choose a .cube file up to 20 MB.');return colorApi.import(await file.text(),file.name,revision);}),attach:(id:string)=>run(revision=>colorApi.attach(id,revision))};
}
