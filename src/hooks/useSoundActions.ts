import {useState} from 'react';
import type {SavedSound, SoundDefinition, SoundValues} from '../../shared/sound-presets';
import {projectTracks} from '../../shared/tracks';
import {soundApi} from '../services/sound-api';
import {useEditor} from '../stores/editor-store';

/** Shared asynchronous sound actions for library cards and the customization dialog. */
export function useSoundActions() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const perform = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setError('');
    try {return await operation();} catch(reason) {setError((reason as Error).message); return null;} finally {setBusy(false);}
  };
  return {busy, error,
    add: (sound: SavedSound, values: SoundValues = {}, trackId?: string) => perform(async () => {
      const state = useEditor.getState(); const project = state.snapshot?.project; if(!project) throw new Error('Open a project before placing a sound');
      const selected = projectTracks(project).find(track => track.id === state.selectedTrackId && track.type === 'audio');
      const result = await soundApi.apply({id: sound.id, version: sound.version, revision: project.revision, frame: state.frame, trackId: trackId === '' ? undefined : trackId ?? selected?.id, values});
      useEditor.getState().accept(result); return result;
    }),
    save: (definition: SoundDefinition, existing?: SavedSound) => perform(() => soundApi.save(definition, existing)),
    importRecipe: (file: File) => perform(() => soundApi.import(file)),
    remove: (sound: SavedSound) => perform(() => soundApi.remove(sound)),
  };
}
