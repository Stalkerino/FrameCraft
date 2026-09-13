import {useState} from 'react';
import type {AudioCue} from '../../../shared/auto-audio';
import type {SavedSound} from '../../../shared/sound-presets';
import {Button} from '../atoms/Button';
import {NumberField} from '../atoms/Field';
import {useEditor} from '../../stores/editor-store';
export interface CueChoice {enabled:boolean;frame:number;soundId:string}
export function AutoAudioCueTable({cues,choices,sounds,disabled,onChange}:{cues:AudioCue[];choices:Record<string,CueChoice>;sounds:SavedSound[];disabled:boolean;onChange:(id:string,choice:CueChoice)=>void}) {
  const [page,setPage]=useState(0);const last=Math.max(0,Math.ceil(cues.length/25)-1),current=Math.min(page,last);
  return <div className="auto-audio__cues"><table><thead><tr><th>Use</th><th>Evidence</th><th>Timeline frame</th><th>Sound</th><th/></tr></thead><tbody>{cues.slice(current*25,(current+1)*25).map(cue=>{
    const choice=choices[cue.id]??{enabled:false,frame:cue.frame,soundId:''};
    return <tr key={cue.id}><td><input type="checkbox" aria-label={`Use ${cue.id}`} checked={choice.enabled} disabled={disabled} onChange={e=>onChange(cue.id,{...choice,enabled:e.target.checked})}/></td><td><strong>{cue.kind}</strong><span>{cue.reason}</span></td><td><NumberField label={`${cue.id} frame`} value={choice.frame} disabled={disabled} onCommit={frame=>onChange(cue.id,{...choice,frame})}/></td><td><select aria-label={`${cue.id} sound`} value={choice.soundId} disabled={disabled} onChange={e=>onChange(cue.id,{...choice,soundId:e.target.value})}><option value="">Use category sound</option>{sounds.map(s=><option key={s.id} value={s.id}>{s.definition.name}</option>)}</select></td><td><Button onClick={()=>useEditor.getState().seekTo(choice.frame)}>Seek</Button></td></tr>;
  })}</tbody></table>{cues.length>25&&<div className="auto-audio__pages"><Button disabled={current===0} onClick={()=>setPage(current-1)}>Previous</Button><span>{current+1} / {last+1} · {cues.length} cues</span><Button disabled={current===last} onClick={()=>setPage(current+1)}>Next</Button></div>}</div>;
}
