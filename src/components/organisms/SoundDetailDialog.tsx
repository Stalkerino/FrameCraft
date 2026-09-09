import {useState} from 'react';
import {Download, Play, Plus, Save, Square, Trash2} from 'lucide-react';
import {soundDefinitionSchema, type SavedSound, type SoundDefinition, type SoundValues} from '../../../shared/sound-presets';
import {projectTracks} from '../../../shared/tracks';
import {soundApi} from '../../services/sound-api';
import {useEditor} from '../../stores/editor-store';
import {useSoundActions} from '../../hooks/useSoundActions';
import {Button} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';

interface Props {sound: SavedSound; playing: boolean; onPreview: (values: SoundValues) => void; onStop: () => void; onClose: () => void; onSaved: () => void}
export function SoundDetailDialog({sound, playing, onPreview, onStop, onClose, onSaved}: Props) {
  const project = useEditor(state => state.snapshot?.project); const selectedTrack = useEditor(state => state.selectedTrackId);
  const [name, setName] = useState(sound.definition.name); const [values, setValues] = useState<SoundValues>({duration: sound.definition.duration, pitch: sound.definition.pitch, volume: sound.definition.volume});
  const [trackId, setTrackId] = useState(projectTracks(project ?? {}).find(track => track.id === selectedTrack && track.type === 'audio')?.id ?? '');
  const [recipe, setRecipe] = useState(JSON.stringify(sound.definition.layers, null, 2)); const [error, setError] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const actions = useSoundActions(); const busy = actions.busy;
  const save = async (variation: boolean) => {
    setError(''); let definition: SoundDefinition;
    try {definition = soundDefinitionSchema.parse({...sound.definition, ...values, name: variation && name === sound.definition.name ? `${name.slice(0, 90)} variation` : name, layers: JSON.parse(recipe)});}
    catch(reason) {setError((reason as Error).message); return;}
    if(await actions.save(definition, variation ? undefined : sound)) {onSaved(); onStop(); onClose();}
  };
  const add = async () => {if(await actions.add(sound, values, trackId)) {onStop(); onClose();}};
  const remove = async () => {if(await actions.remove(sound)) {onSaved(); onStop(); onClose();}};
  return <Dialog title="Sound settings" onClose={onClose}><div className="sound-detail settings-form"><p className="settings-description">{sound.definition.description}</p>
    <label className="field"><span>Name</span><input value={name} maxLength={100} onChange={event => setName(event.target.value)}/></label>
    <div className="sound-detail__controls">{([{key: 'duration', label: 'Duration (s)', min: .08, max: 4, step: .01}, {key: 'pitch', label: 'Pitch', min: .25, max: 4, step: .05}, {key: 'volume', label: 'Volume', min: 0, max: 1, step: .05}] as const).map(control => <label className="field" key={control.key}><span>{control.label}</span><input type="number" min={control.min} max={control.max} step={control.step} value={values[control.key]} onChange={event => {onStop(); setValues(current => ({...current, [control.key]: event.target.valueAsNumber}));}}/></label>)}</div>
    <label className="field"><span>Destination track</span><select value={trackId} onChange={event => setTrackId(event.target.value)}><option value="">First audio track · create if needed</option>{projectTracks(project ?? {}).filter(track => track.type === 'audio').map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
    <details className="sound-detail__recipe"><summary>Advanced synthesis layers</summary><p>Edit sine, triangle or filtered-noise layers. Save before previewing layer changes.</p><textarea aria-label="Sound synthesis layers" spellCheck={false} value={recipe} onChange={event => setRecipe(event.target.value)}/></details>
    {(error || actions.error) && <p role="alert" className="agent-inline-error">{error || actions.error}</p>}
    <div className="sound-detail__actions"><Button icon={playing ? <Square size={14}/> : <Play size={14}/>} onClick={() => onPreview(values)}>{playing ? 'Stop preview' : 'Preview'}</Button><Button variant="primary" disabled={busy || !project} icon={<Plus size={14}/>} onClick={() => void add()}>Add at playhead</Button><Button disabled={busy} icon={<Save size={14}/>} onClick={() => void save(false)}>Save changes</Button><Button disabled={busy} onClick={() => void save(true)}>Save variation</Button><a href={soundApi.downloadUrl(sound.id)} download><Download size={14}/> Recipe</a><Button disabled={busy} icon={<Trash2 size={14}/>} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}>{confirmDelete ? 'Confirm delete' : 'Delete'}</Button></div>
    <p className="library-note">Saved sounds are shared across projects. Existing timeline clips keep their generated audio.</p>
  </div></Dialog>;
}
