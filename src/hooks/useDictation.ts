import {useEffect, useRef, useState} from 'react';
import {createDictation, speechAvailable} from '../services/speech-service';
import {createLocalDictation, localDictationAvailable, localDictationUnavailableReason, type VoicePhase} from '../services/local-dictation-service';
export function useDictation(onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>('idle'); const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'browser' | 'local'>(() => speechAvailable() ? 'browser' : 'local');
  const [language, setLanguage] = useState(() => navigator.language.startsWith('fr') ? 'fr-FR' : 'en-US');
  const active = useRef<{start: () => void | Promise<void>; stop: () => void; dispose: () => void} | null>(null);
  const callback = useRef(onTranscript); callback.current = onTranscript;
  useEffect(() => () => active.current?.dispose(), []);
  const start = () => {
    active.current?.dispose(); setError(null); setProgress('');
    try {
      active.current = mode === 'local' ? createLocalDictation(language, {transcript: text => callback.current(text), error: setError, phase: setPhase, progress: setProgress}) : createDictation(language, {transcript: text => callback.current(text), error: text => {setError(text); setPhase('idle'); active.current?.stop();}, end: () => setPhase('idle')});
      if(mode === 'browser') setPhase('listening'); void active.current.start();
    } catch(error) {setError((error as Error).message); setPhase('idle');}
  };
  const available = mode === 'browser' ? speechAvailable() : localDictationAvailable();
  return {available, unavailableReason: available ? '' : localDictationUnavailableReason(), browserAvailable: speechAvailable(), mode, setMode, phase, progress, listening: phase === 'listening', busy: phase !== 'idle', error, language, setLanguage, start, stop: () => active.current?.stop(), cancel: () => {active.current?.dispose(); setPhase('idle');}};
}
