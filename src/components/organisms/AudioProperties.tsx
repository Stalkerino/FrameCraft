import {Plus, RotateCcw, Trash2, Volume2} from 'lucide-react';
import {useState} from 'react';
import {keyframeGain, type AudioEnvelope} from '../../../shared/audio-envelope';
import type {AudioEffects} from '../../../shared/audio-effects';
import type {Clip, Project} from '../../../shared/project';
import {clipTrackId, projectTracks} from '../../../shared/tracks';
import {useAudioEditing} from '../../hooks/useAudioEditing';
import {useEditor} from '../../stores/editor-store';
import {Button, IconButton} from '../atoms/Button';
import {Field, NumberField} from '../atoms/Field';

export function AudioProperties({clip, project}: {clip: Clip; project: Project}) {
  const {fps} = project;
  const editing = useAudioEditing(clip, project.id);
  const busy = useEditor(state => state.busy) || editing.pending || editing.running;
  const envelope: AudioEnvelope = clip.audioEnvelope ?? {duration: clip.duration, offset: 0, fadeIn: 0, fadeOut: 0, keyframes: []};
  const [triggerId, setTriggerId] = useState('');
  const [reduction, setReduction] = useState(75);
  const [attack, setAttack] = useState(.2); const [release, setRelease] = useState(.4);
  const initialEffects = project.assets.find(asset => asset.id === clip.assetId)?.audioProcessing?.effects;
  const [eqEnabled, setEqEnabled] = useState(Boolean(initialEffects?.equalizer));
  const [compressorEnabled, setCompressorEnabled] = useState(Boolean(initialEffects?.compressor));
  const [reverbEnabled, setReverbEnabled] = useState(Boolean(initialEffects?.reverb));
  const [equalizer, setEqualizer] = useState(initialEffects?.equalizer ?? {low: 0, mid: 0, high: 0});
  const [compressor, setCompressor] = useState(initialEffects?.compressor ?? {threshold: -18, ratio: 4, attack: 10, release: 180, makeup: 0});
  const [reverb, setReverb] = useState(initialEffects?.reverb ?? {wet: .2, room: .5});
  const triggerTracks = projectTracks(project).filter(track => track.id !== clipTrackId(project, clip) && !track.muted && !track.hidden && project.clips.some(candidate => clipTrackId(project, candidate) === track.id && (candidate.kind === 'video' || candidate.kind === 'audio')));
  const foreground = triggerTracks.some(track => track.id === triggerId) ? triggerId : triggerTracks[0]?.id ?? '';
  const localPoints = envelope.keyframes.map((point, index) => ({point, index, localFrame: point.frame - envelope.offset})).filter(point => point.localFrame >= 0 && point.localFrame <= clip.duration);
  const outsidePoints = envelope.keyframes.length - localPoints.length;
  const earliest = Math.max(0, envelope.offset); const latest = Math.min(envelope.duration, envelope.offset + clip.duration);
  const occupied = new Set(envelope.keyframes.map(point => point.frame));
  const hasPointSpace = latest >= earliest && localPoints.length < latest - earliest + 1;
  const save = (patch: Partial<AudioEnvelope>) => void editing.saveEnvelope({...envelope, ...patch});
  const updatePoint = (index: number, change: Partial<AudioEnvelope['keyframes'][number]>) => save({keyframes: envelope.keyframes.map((point, candidate) => candidate === index ? {...point, ...change} : point).sort((a, b) => a.frame - b.frame)});
  const addPoint = () => {
    let frame = Math.max(earliest, Math.min(latest, useEditor.getState().frame - clip.start + envelope.offset));
    while(frame <= latest && occupied.has(frame)) frame++;
    if(frame > latest) {frame = earliest; while(frame <= latest && occupied.has(frame)) frame++;}
    if(frame <= latest) save({keyframes: [...envelope.keyframes, {frame, value: keyframeGain(envelope.keyframes, frame)}].sort((a, b) => a.frame - b.frame)});
  };
  const effects: AudioEffects = {...(eqEnabled ? {equalizer} : {}), ...(compressorEnabled ? {compressor} : {}), ...(reverbEnabled ? {reverb} : {})};
  return <div className="audio-properties">
    <NumberField label="Volume" value={Math.round(clip.volume * 100)} max={100} suffix="%" disabled={busy} onCommit={volume => void useEditor.getState().updateClip(clip.id, {volume: volume / 100}, 'Changed clip volume')}/>
    <div className="field-row"><NumberField label="Fade in" value={envelope.fadeIn / fps} max={envelope.duration / fps} step={1 / fps} suffix="s" disabled={busy} onCommit={seconds => save({fadeIn: Math.round(seconds * fps)})}/><NumberField label="Fade out" value={envelope.fadeOut / fps} max={envelope.duration / fps} step={1 / fps} suffix="s" disabled={busy} onCommit={seconds => save({fadeOut: Math.round(seconds * fps)})}/></div>
    {(envelope.offset !== 0 || envelope.duration !== clip.duration) && <p className="field-help">Original envelope: {(envelope.duration / fps).toFixed(2)} s. This fragment starts at {(envelope.offset / fps).toFixed(2)} s in that envelope; fades keep their original timing.</p>}
    <details className="audio-properties__group">
      <summary>Volume automation <span>{envelope.keyframes.length} points</span></summary>
      <p className="field-help">Point times are relative to this clip. Gain multiplies its volume; points interpolate linearly.</p>
      <div className="audio-properties__points">{localPoints.map(({point, index, localFrame}) => <div className="audio-properties__point" key={point.frame}>
        <NumberField label={`Point ${index + 1} time`} value={localFrame / fps} min={Math.max(0, -envelope.offset) / fps} max={Math.min(clip.duration, envelope.duration - envelope.offset) / fps} step={1 / fps} suffix="s" disabled={busy} onCommit={seconds => updatePoint(index, {frame: Math.round(seconds * fps) + envelope.offset})}/>
        <NumberField label={`Point ${index + 1} gain`} value={Math.round(point.value * 100)} max={100} suffix="%" disabled={busy} onCommit={value => updatePoint(index, {value: value / 100})}/>
        <IconButton label={`Remove audio point ${index + 1}`} disabled={busy} onClick={() => save({keyframes: envelope.keyframes.filter((_, candidate) => candidate !== index)})}><Trash2 size={13}/></IconButton>
      </div>)}</div>
      {outsidePoints > 0 && <p className="field-help">{outsidePoints} points outside this fragment are preserved.</p>}
      <Button type="button" icon={<Plus size={13}/>} disabled={busy || !hasPointSpace} onClick={addPoint}>Add point at playhead</Button>
    </details>
    {clip.audioEnvelope && <button type="button" className="audio-properties__reset" disabled={busy} onClick={() => void editing.saveEnvelope(null)}><RotateCcw size={12}/> Reset fades & automation</button>}

    <details className="audio-properties__group">
      <summary>Automatic ducking</summary>
      <p className="field-help">Lower this clip while foreground clips overlap. This uses their timeline ranges, not speech detection, and replaces this clip’s fades and automation.</p>
      <Field label="Foreground track"><select aria-label="Foreground track" value={foreground} disabled={busy || !triggerTracks.length} onChange={event => setTriggerId(event.target.value)}>{!triggerTracks.length && <option value="">Add another audible track</option>}{triggerTracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field>
      <NumberField label="Reduce volume by" value={reduction} max={100} suffix="%" disabled={busy} onCommit={setReduction}/>
      <div className="field-row"><NumberField label="Ducking attack" value={attack} step={.05} suffix="s" disabled={busy} onCommit={setAttack}/><NumberField label="Ducking release" value={release} step={.05} suffix="s" disabled={busy} onCommit={setRelease}/></div>
      <Button type="button" disabled={busy || !foreground} onClick={() => void editing.applyDucking(foreground, 1 - reduction / 100, Math.round(attack * fps), Math.round(release * fps))}>Apply ducking</Button>
    </details>

    <details className="audio-properties__group">
      <summary>Audio effects</summary>
      <p className="field-help">Render a processed audio copy for playback and export. Original media stays intact. For video, this adds an audio clip and mutes the video’s sound.</p>
      {initialEffects && <p className="field-help">This is a processed copy. Applying new settings starts from its retained original source.</p>}
      <label className="audio-properties__toggle"><input type="checkbox" checked={eqEnabled} disabled={busy} onChange={event => setEqEnabled(event.target.checked)}/> Three-band equalizer</label>
      {eqEnabled && <div className="audio-properties__equalizer">{(['low', 'mid', 'high'] as const).map(band => <NumberField key={band} label={`${band[0].toUpperCase()}${band.slice(1)} EQ`} value={equalizer[band]} min={-24} max={24} suffix="dB" disabled={busy} onCommit={value => setEqualizer({...equalizer, [band]: value})}/>)}</div>}
      <label className="audio-properties__toggle"><input type="checkbox" checked={compressorEnabled} disabled={busy} onChange={event => setCompressorEnabled(event.target.checked)}/> Compressor</label>
      {compressorEnabled && <div className="field-row"><NumberField label="Threshold" value={compressor.threshold} min={-60} max={0} suffix="dB" disabled={busy} onCommit={threshold => setCompressor({...compressor, threshold})}/><NumberField label="Ratio" value={compressor.ratio} min={1} max={20} step={.5} suffix=":1" disabled={busy} onCommit={ratio => setCompressor({...compressor, ratio})}/></div>}
      <label className="audio-properties__toggle"><input type="checkbox" checked={reverbEnabled} disabled={busy} onChange={event => setReverbEnabled(event.target.checked)}/> Room reverb</label>
      {reverbEnabled && <div className="field-row"><NumberField label="Wet mix" value={Math.round(reverb.wet * 100)} max={100} suffix="%" disabled={busy} onCommit={wet => setReverb({...reverb, wet: wet / 100})}/><NumberField label="Room size" value={Math.round(reverb.room * 100)} max={100} suffix="%" disabled={busy} onCommit={room => setReverb({...reverb, room: room / 100})}/></div>}
      {reverbEnabled && <p className="field-help">Reverb is trimmed at the clip’s end to keep the timeline synchronized.</p>}
      <Button type="button" icon={<Volume2 size={13}/>} disabled={busy || (!eqEnabled && !compressorEnabled && !reverbEnabled)} onClick={() => void editing.applyEffects(effects)}>Apply audio effects</Button>
    </details>
    {editing.job && <div className={`audio-properties__job audio-properties__job--${editing.job.status}`} role="status">
      <span>{editing.job.status === 'done' ? 'Audio effects applied' : editing.job.status === 'error' ? 'Audio processing failed' : editing.job.status === 'cancelled' ? 'Audio processing cancelled' : editing.job.status === 'queued' ? 'Audio processing queued' : `Processing audio · ${Math.round(editing.job.progress * 100)}%`}</span>
      {editing.running && <><progress aria-label="Audio processing progress" max={1} value={editing.job.progress}/><Button type="button" disabled={editing.pending} onClick={() => void editing.cancelEffects()}>Cancel processing</Button></>}
      {editing.job.error && <p>{editing.job.error}</p>}
      {editing.job.status === 'done' && editing.job.clipIds?.[0] !== clip.id && <Button type="button" onClick={() => {
        const processed = project.clips.find(candidate => candidate.id === editing.job!.clipIds?.[0]);
        if(processed) useEditor.setState({selectedId: processed.id, selectedTrackId: clipTrackId(project, processed), inspectorTab: 'properties'});
      }}>Select processed audio</Button>}
    </div>}
    {editing.error && <p className="audio-properties__error" role="alert">{editing.error}</p>}
  </div>;
}
