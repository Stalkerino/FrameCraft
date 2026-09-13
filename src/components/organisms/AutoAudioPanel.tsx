import {useEffect,useState} from 'react';
import {autoAudioAnalyzeSchema} from '../../../shared/auto-audio';
import {projectTracks,clipTrackId} from '../../../shared/tracks';
import {useAutoAudio} from '../../hooks/useAutoAudio';
import {useSoundLibrary} from '../../hooks/useSoundLibrary';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Field,NumberField} from '../atoms/Field';
import {AutoAudioCueTable,type CueChoice} from '../molecules/AutoAudioCueTable';

export function AutoAudioPanel() {
  const project=useEditor(s=>s.snapshot?.project),busy=useEditor(s=>s.busy),selected=useEditor(s=>s.selectedIds),selectedId=useEditor(s=>s.selectedId);
  const auto=useAutoAudio(),library=useSoundLibrary();
  const [settings,setSettings]=useState(()=>autoAudioAnalyzeSchema.parse(auto.report?.settings??{revision:0,sourceTrackIds:projectTracks(project??{}).filter(t=>t.type==='visual').map(t=>t.id)}));
  const [targets,setTargets]=useState<string[]>(()=>auto.report?.settings.excludeClipIds??project?.clips.filter(c=>c.kind==='audio'&&(selected.includes(c.id)||c.id===selectedId)).map(c=>c.id)??[]);
  const [gain,setGain]=useState(25),[attack,setAttack]=useState(.2),[release,setRelease]=useState(.4),[duck,setDuck]=useState(true),[sfx,setSfx]=useState(true);
  const [impact,setImpact]=useState('impact-soft'),[transition,setTransition]=useState('whoosh-soft'),[volume,setVolume]=useState(65),[trackId,setTrackId]=useState('');
  const [choices,setChoices]=useState<Record<string,CueChoice>>({}),[activityIds,setActivityIds]=useState<string[]>([]);
  const report=auto.report,disabled=busy||auto.pending||auto.running;
  useEffect(()=>{if(report?.status==='ready'){setChoices(Object.fromEntries(report.cues.map(c=>[c.id,{enabled:true,frame:c.frame,soundId:''}])));setActivityIds(report.activity.map(r=>r.id));}},[report?.id,report?.status]);
  if(!project)return null;
  const tracks=projectTracks(project).filter(t=>t.type!=='text'),clips=project.clips.filter(c=>['audio','video','sequence'].includes(c.kind));
  const toggle=(values:string[],id:string)=>values.includes(id)?values.filter(value=>value!==id):[...values,id];
  const soundFor=(kind:string,id='')=>library.sounds.find(s=>s.id===(id|| (kind==='transition'?transition:impact)));
  const placements=sfx?(report?.cues??[]).flatMap(cue=>{const choice=choices[cue.id],sound=soundFor(cue.kind,choice?.soundId);return choice?.enabled&&sound?[{candidateId:cue.id,frame:choice.frame,sound:{id:sound.id,version:sound.version,values:{}},volume:volume/100}]:[];}):[];
  const missingSound=sfx&&(report?.cues??[]).some(c=>choices[c.id]?.enabled&&!soundFor(c.kind,choices[c.id]?.soundId));
  const changed=!!report&&JSON.stringify({...settings,revision:report.revision,excludeClipIds:targets})!==JSON.stringify(report.settings);
  const ready=report?.status==='ready'&&!auto.stale&&!changed&&!disabled&&!missingSound&&((duck&&targets.length>0&&activityIds.length>0)||placements.length>0);
  return <div className="auto-audio">
    <p className="field-help">Analyze selected foreground tracks, then review activity ducking and sound cues. Sound energy is detected locally; this does not identify speech, actions or objects in the video.</p>
    <div className="auto-audio__settings"><section><h3>Detection sources</h3><div className="auto-audio__checklist">{tracks.map(track=><label key={track.id}><input aria-label={`Detect ${track.name}`} type="checkbox" checked={settings.sourceTrackIds.includes(track.id)} disabled={disabled} onChange={()=>setSettings({...settings,sourceTrackIds:toggle(settings.sourceTrackIds,track.id)})}/>{track.name}{track.muted||track.hidden?' (muted/hidden)':''}</label>)}</div>
      <NumberField label="Activity threshold" value={settings.thresholdDb} min={-80} max={0} suffix="dBFS" disabled={disabled} onCommit={thresholdDb=>setSettings({...settings,thresholdDb})}/>
      <div className="field-row"><NumberField label="Minimum activity" value={settings.minActiveMs} min={20} max={2000} suffix="ms" disabled={disabled} onCommit={minActiveMs=>setSettings({...settings,minActiveMs})}/><NumberField label="Join pauses under" value={settings.holdMs} min={0} max={3000} suffix="ms" disabled={disabled} onCommit={holdMs=>setSettings({...settings,holdMs})}/></div>
      <details><summary>Sound cue detection</summary><NumberField label="Attack rise" value={settings.transientRiseDb} min={1} max={30} suffix="dB" disabled={disabled} onCommit={transientRiseDb=>setSettings({...settings,transientRiseDb})}/><NumberField label="Minimum attack peak" value={settings.transientMinDb} min={-60} max={0} suffix="dBFS" disabled={disabled} onCommit={transientMinDb=>setSettings({...settings,transientMinDb})}/><NumberField label="Minimum cue spacing" value={settings.minSpacingMs/1000} min={.1} max={30} step={.1} suffix="s" disabled={disabled} onCommit={value=>setSettings({...settings,minSpacingMs:value*1000})}/></details>
      <label><input type="checkbox" checked={settings.includeCuts} disabled={disabled} onChange={e=>setSettings({...settings,includeCuts:e.target.checked})}/> Suggest at cuts and transitions</label><label><input type="checkbox" checked={settings.includeMarkers} disabled={disabled} onChange={e=>setSettings({...settings,includeMarkers:e.target.checked})}/> Suggest at markers</label>
      <Button disabled={disabled} onClick={()=>void auto.analyze({...settings,excludeClipIds:targets})}>{report?'Analyze again':'Analyze sequence'}</Button>{auto.running&&<Button onClick={()=>void auto.cancel()}>Cancel analysis</Button>}
    </section><section><h3>Background ducking</h3><label><input type="checkbox" checked={duck} disabled={disabled} onChange={e=>setDuck(e.target.checked)}/> Apply detected activity ducking</label>
      <div className="auto-audio__checklist">{clips.map(clip=><label key={clip.id}><input aria-label={`Duck ${clip.name}`} type="checkbox" checked={targets.includes(clip.id)} disabled={disabled} onChange={()=>setTargets(toggle(targets,clip.id))}/>{clip.name} <small>{tracks.find(t=>t.id===clipTrackId(project,clip))?.name}</small></label>)}</div>
      <NumberField label="Remaining background gain" value={gain} max={100} suffix="%" disabled={disabled} onCommit={setGain}/><div className="field-row"><NumberField label="Ducking attack" value={attack} min={0} step={.05} suffix="s" disabled={disabled} onCommit={setAttack}/><NumberField label="Ducking release" value={release} min={0} step={.05} suffix="s" disabled={disabled} onCommit={setRelease}/></div>
      <p className="field-help">Targets are excluded from detection. Existing manual volume and fades are preserved; reapplying replaces only the activity ducking layer.</p>
      <h3>Sound effects</h3><label><input type="checkbox" checked={sfx} disabled={disabled} onChange={e=>setSfx(e.target.checked)}/> Place selected sound cues</label>
      {[['Impact sound',impact,setImpact],['Transition sound',transition,setTransition]] .map(([label,value,set])=><div className="auto-audio__sound" key={String(label)}><Field label={String(label)}><select aria-label={String(label)} value={String(value)} disabled={disabled} onChange={e=>(set as (value:string)=>void)(e.target.value)}>{library.sounds.map(s=><option key={s.id} value={s.id}>{s.definition.name}</option>)}</select></Field><Button disabled={!library.sounds.some(s=>s.id===value)} onClick={()=>{const sound=library.sounds.find(s=>s.id===value);if(sound)void library.preview(sound,{});}}>Listen</Button></div>)}
      <div className="field-row"><NumberField label="SFX volume" value={volume} max={100} suffix="%" disabled={disabled} onCommit={setVolume}/><Field label="SFX track"><select aria-label="SFX track" value={trackId} disabled={disabled} onChange={e=>setTrackId(e.target.value)}><option value="">New Auto SFX track</option>{tracks.filter(t=>t.type==='audio').map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
    </section></div>
    {report&&<div className="auto-audio__results"><p role="status">{report.appliedRevision?`Applied at revision ${report.appliedRevision}.`:auto.stale||changed?'Analysis or detector settings changed. Analyze again before applying.':report.detail||report.status}</p>{auto.running&&<progress max={1} value={report.progress}/>}
      {report.status==='ready'&&<><details><summary>{report.activity.length} detected activity ranges · {activityIds.length} selected</summary><div className="auto-audio__ranges">{report.activity.map(range=><label key={range.id}><input type="checkbox" checked={activityIds.includes(range.id)} disabled={disabled||auto.stale} onChange={()=>setActivityIds(toggle(activityIds,range.id))}/>{(range.start/report.fps).toFixed(2)}–{(range.end/report.fps).toFixed(2)} s · {range.peakDb.toFixed(1)} dBFS</label>)}</div></details>
      <div className="auto-audio__actions"><strong>{report.cues.length} suggested sound cues</strong><Button disabled={disabled||auto.stale} onClick={()=>setChoices(Object.fromEntries(Object.entries(choices).map(([id,c])=>[id,{...c,enabled:true}])))}>Select all cues</Button><Button disabled={disabled||auto.stale} onClick={()=>setChoices(Object.fromEntries(Object.entries(choices).map(([id,c])=>[id,{...c,enabled:false}])))}>Clear cues</Button></div>
      <AutoAudioCueTable cues={report.cues} choices={choices} sounds={library.sounds} disabled={disabled||auto.stale} onChange={(id,choice)=>setChoices({...choices,[id]:choice})}/>
      <Button variant="primary" disabled={!ready} onClick={()=>void auto.apply({...(duck&&targets.length&&activityIds.length?{duck:{targetClipIds:targets,gain:gain/100,attackFrames:Math.round(attack*project.fps),releaseFrames:Math.round(release*project.fps),activityIds}}:{}),placements,...(trackId?{trackId}:{})})}>Apply selected audio edits</Button>
      {missingSound&&<p role="alert">Choose an available saved sound for every selected cue.</p>}</>}
    </div>}
    {(auto.error||library.error)&&<p role="alert">{auto.error||library.error}</p>}
  </div>;
}
