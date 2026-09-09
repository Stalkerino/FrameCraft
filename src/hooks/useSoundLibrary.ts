import {useCallback, useEffect, useRef, useState} from 'react';
import type {SavedSound, SoundValues} from '../../shared/sound-presets';
import {soundApi} from '../services/sound-api';

export function useSoundLibrary() {
  const [sounds, setSounds] = useState<SavedSound[]>([]); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null); const audio = useRef<HTMLAudioElement | null>(null); const requestId = useRef(0); const revision = useRef(-1);
  const refresh = useCallback(async () => {
    try {const catalog = await soundApi.list(); if(catalog.revision >= revision.current) {revision.current = catalog.revision; setSounds(catalog.sounds); setLoaded(true); setError('');}}
    catch(reason) {setError((reason as Error).message);}
  }, []);
  const stop = useCallback(() => {requestId.current++; audio.current?.pause(); if(audio.current) {audio.current.removeAttribute('src'); audio.current.load();} audio.current = null; setPlaying(null);}, []);
  useEffect(() => {void refresh(); const disconnect = soundApi.subscribe(() => {void refresh();}, () => setError('Sound library disconnected. Reconnecting…')); return () => {disconnect(); stop();};}, [refresh, stop]);
  const preview = async (sound: SavedSound, values: SoundValues) => {
    if(playing === sound.id) {stop(); return;}
    stop(); const current = requestId.current; setPlaying(sound.id); setError('');
    try {
      const result = await soundApi.preview(sound, values); if(requestId.current !== current) return;
      const player = new Audio(result.src); audio.current = player;
      player.onended = () => {if(audio.current === player) stop();};
      player.onerror = () => {if(audio.current === player) {stop(); setError('Could not play the generated sound');}};
      await player.play();
    } catch(reason) {if(requestId.current === current) {stop(); setError((reason as Error).message);}}
  };
  return {sounds, error, loaded, playing, refresh, preview, stop, setError};
}
