import {useEffect,useState} from 'react';
import type {AudioMeasurement,TrackMix} from '../../../shared/audio-mixer';
import {NumberField} from '../atoms/Field';
import {Button} from '../atoms/Button';
export const levelText=(value:number|null|undefined,unit:string)=>value===undefined?'—':value===null?'−∞':`${value.toFixed(1)} ${unit}`;
export function AudioChannelStrip({name,mix,muted,disabled,levels,onChange,onMute}:{name:string;mix:TrackMix;muted:boolean;disabled:boolean;levels?:AudioMeasurement;onChange:(mix:TrackMix)=>void;onMute:(value:boolean)=>void}) {
  const [gain,setGain]=useState(mix.gainDb);useEffect(()=>setGain(mix.gainDb),[mix.gainDb]);
  const commit=()=>{if(gain!==mix.gainDb)onChange({...mix,gainDb:gain});};
  return <section className="audio-channel" aria-label={`${name} mixer`}>
    <h3 title={name}>{name}</h3>
    <div className="audio-channel__switches"><Button aria-pressed={muted} disabled={disabled} onClick={()=>onMute(!muted)}>Mute</Button><Button aria-pressed={mix.solo} disabled={disabled} onClick={()=>onChange({...mix,solo:!mix.solo})}>Solo</Button></div>
    <label className="audio-channel__fader"><span>Gain</span><input aria-label={`${name} gain fader`} type="range" min={-60} max={24} step={.5} value={gain} disabled={disabled} onChange={e=>setGain(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}/></label>
    <NumberField label={`${name} gain`} value={mix.gainDb} min={-60} max={24} step={.5} suffix="dB" disabled={disabled} onCommit={gainDb=>onChange({...mix,gainDb})}/>
    <NumberField label={`${name} pan`} value={mix.pan*100} min={-100} max={100} suffix="L/R" disabled={disabled} onCommit={pan=>onChange({...mix,pan:pan/100})}/>
    <div className="audio-channel__levels"><span>LUFS <strong>{levelText(levels?.integratedLufs,'')}</strong></span><span>True peak <strong>{levelText(levels?.truePeakDb,'dBTP')}</strong></span><span>L / R <strong>{levelText(levels?.leftPeakDb,'')} / {levelText(levels?.rightPeakDb,'dBFS')}</strong></span></div>
  </section>;
}
