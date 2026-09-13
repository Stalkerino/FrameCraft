import {useState} from 'react';
import {AutoAudioPanel} from './AutoAudioPanel';
import {projectTracks} from '../../../shared/tracks';
import {activeSequenceId} from '../../../shared/project-sequences';
import {masterMixSchema,trackMixSchema} from '../../../shared/audio-mixer';
import {useEditor} from '../../stores/editor-store';
import {useAudioMixer} from '../../hooks/useAudioMixer';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {NumberField} from '../atoms/Field';
import {AudioChannelStrip,levelText} from '../molecules/AudioChannelStrip';
export function AudioMixerDialog({onClose}:{onClose:()=>void}) {
  const [tab,setTab]=useState<'mixer'|'auto'>('mixer');
  const tabs=<div className="audio-mixer__tabs"><Button aria-pressed={tab==='mixer'} onClick={()=>setTab('mixer')}>Mixer</Button><Button aria-pressed={tab==='auto'} onClick={()=>setTab('auto')}>Auto audio</Button></div>;
  const snapshot=useEditor(s=>s.snapshot);const busy=useEditor(s=>s.busy);const mixer=useAudioMixer();if(!snapshot)return null;
  const project=snapshot.project,master=masterMixSchema.parse(project.audioMix??{}),disabled=busy||mixer.pending;
  const measurement=mixer.measurement,measuring=!!measurement&&['queued','processing'].includes(measurement.status);
  const same=measurement?.projectId===project.id&&measurement.sequenceId===activeSequenceId(project),stale=same&&measurement.revision!==project.revision;
  const levels=same?measurement.master:undefined;
  const setMaster=(patch:Partial<typeof master>)=>void mixer.set({master:{...master,...patch}});
  if(tab==='auto')return <Dialog title="Audio mixer" className="audio-mixer-dialog" onClose={onClose}>{tabs}<AutoAudioPanel key={`${project.id}/${project.sequenceId??'main'}`}/></Dialog>;
  return <Dialog title="Audio mixer" className="audio-mixer-dialog" onClose={onClose}>
    {tabs}
    <div className="audio-mixer__toolbar"><p>Sequence tracks → master. Pan: −100 left, 0 center, +100 right.</p><Button disabled={disabled||!snapshot.canUndo} onClick={()=>void useEditor.getState().history('undo')}>Undo</Button><Button disabled={disabled||!snapshot.canRedo} onClick={()=>void useEditor.getState().history('redo')}>Redo</Button><Button disabled={disabled||measuring} onClick={()=>void mixer.measure()}>Measure mix</Button>{measuring&&<Button onClick={()=>void mixer.cancel()}>Cancel measurement</Button>}</div>
    <div className="audio-mixer__body"><div className="audio-mixer__tracks">{projectTracks(project).filter(t=>t.type!=='text').map(track=><AudioChannelStrip key={track.id} name={track.name} mix={trackMixSchema.parse(track.mix??{})} muted={track.muted} disabled={disabled} levels={same?measurement.tracks?.find(t=>t.id===track.id)?.levels:undefined} onChange={mix=>void mixer.set({tracks:[{id:track.id,mix}]})} onMute={muted=>void mixer.set({tracks:[{id:track.id,muted}]})}/>)}</div>
    <section className="audio-mixer__master" aria-label="Master mixer"><h3>Master</h3>
      {(project.masterVolume??1)!==1&&<p className="field-help">Sequence volume: {Math.round((project.masterVolume??1)*100)}% from Project settings, before master gain.</p>}
      <Button aria-pressed={master.muted} disabled={disabled} onClick={()=>setMaster({muted:!master.muted})}>Mute master</Button>
      <NumberField label="Master gain" min={-60} max={24} step={.5} suffix="dB" value={master.gainDb} disabled={disabled} onCommit={gainDb=>setMaster({gainDb})}/>
      <NumberField label="Master pan" min={-100} max={100} suffix="L/R" value={master.pan*100} disabled={disabled} onCommit={pan=>setMaster({pan:pan/100})}/>
      <label><input type="checkbox" checked={!!master.normalization} disabled={disabled} onChange={e=>setMaster({normalization:e.target.checked?{targetLufs:-16}:null})}/> Loudness normalization</label>
      {master.normalization&&<NumberField label="Target loudness" min={-36} max={-5} suffix="LUFS" value={master.normalization.targetLufs} disabled={disabled} onCommit={targetLufs=>setMaster({normalization:{targetLufs}})}/>}
      <label><input type="checkbox" checked={!!master.limiter} disabled={disabled} onChange={e=>setMaster({limiter:e.target.checked?{ceilingDb:-1}:null})}/> Master limiter</label>
      {master.limiter&&<NumberField label="Limiter ceiling" min={-12} max={0} step={.1} suffix="dBTP" value={master.limiter.ceilingDb} disabled={disabled} onCommit={ceilingDb=>setMaster({limiter:{ceilingDb}})}/>}
      <div className="audio-channel__levels"><span>Integrated <strong>{levelText(levels?.integratedLufs,'LUFS')}</strong></span><span>True peak <strong>{levelText(levels?.truePeakDb,'dBTP')}</strong></span><span>Sample peak <strong>{levelText(levels?.samplePeakDb,'dBFS')}</strong></span><span>Loudness range <strong>{levels?.loudnessRange==null?'—':`${levels.loudnessRange.toFixed(1)} LU`}</strong></span></div>
      <Button disabled={disabled} onClick={()=>void mixer.set({master:null,tracks:projectTracks(project).filter(t=>t.type!=='text').map(t=>({id:t.id,mix:null,muted:false}))})}>Reset mixer</Button>
    </section></div>
    <p className="field-help" role="status">{measuring?'Measuring the complete sequence…':same&&measurement.status==='done'?`${stale?'Outdated measurement':'Measured mix'} · revision ${measurement.revision}. Tracks are measured after faders; master includes normalization and limiting.`:'Measure mix for LUFS and peaks. No measurement yet.'}</p>
    <p className="field-help">Normalization applies a constant gain (up to ±24 dB), followed by the oversampled limiter when enabled. Measure the result to check the achieved loudness. Source files stay intact; audio preparation is cached for preview and export.</p>
    {mixer.error&&<p role="alert">{mixer.error}</p>}
  </Dialog>;
}
