import {useEffect, useRef, useState} from 'react';
import {monitorAudio, type AudioLevels} from '../../services/audio-meter-service';
export function AudioMeters() {
  const ref = useRef<HTMLDivElement>(null); const stop = useRef<(() => void) | undefined>(undefined); const generation = useRef(0);
  const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [levels, setLevels] = useState<AudioLevels>({left: -60, right: -60});
  useEffect(() => () => {generation.current++; stop.current?.();}, []);
  const toggle = async () => {
    if(enabled) {stop.current?.(); stop.current = undefined; setEnabled(false); return;}
    const root = ref.current?.closest<HTMLElement>('.preview'); if(!root) return;
    const current = ++generation.current; setBusy(true); setError('');
    try {const dispose = await monitorAudio(root, setLevels); if(current !== generation.current) dispose(); else {stop.current = dispose; setEnabled(true);}}
    catch(e) {if(current === generation.current) setError((e as Error).message);}
    finally {if(current === generation.current) setBusy(false);}
  };
  return <div className="audio-meters" ref={ref} title={error || 'Live stereo sample peaks in dBFS. Red indicates clipping; these are not loudness or true-peak measurements.'}>
    <button aria-label="Toggle audio meters" aria-pressed={enabled} disabled={busy} onClick={() => void toggle()}>Levels</button>
    {enabled && (['left', 'right'] as const).map(channel => <span key={channel} className={`audio-meters__channel ${levels[channel] >= 0 ? 'clipping' : ''}`} role="meter" aria-label={`${channel} audio peak`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.min(0, Math.round(levels[channel]))}><i style={{width: `${Math.min(100, Math.max(0, (levels[channel] + 60) / 60 * 100))}%`}}/></span>)}
    {error && <span role="alert">Meters unavailable</span>}
  </div>;
}
