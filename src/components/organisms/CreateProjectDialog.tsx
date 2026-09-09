import {useState} from 'react';
import {canvasSettingsSchema} from '../../../shared/media-settings';
import {projectActionSchema} from '../../../shared/project-library';
import {useEditor} from '../../stores/editor-store';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {ResolutionFields} from '../molecules/ResolutionFields';
export function CreateProjectDialog({mode, onClose}: {mode: 'new' | 'copy'; onClose: () => void}) {
  const [original] = useState(useEditor.getState().snapshot!.project);
  const [name, setName] = useState(mode === 'copy' ? `${original.name.slice(0, 115)} copy` : 'Untitled project');
  const [settings, setSettings] = useState(() => canvasSettingsSchema.parse(original));
  const [error, setError] = useState(''); const busy = useEditor(s => s.busy); const mutationError = useEditor(s => s.error);
  return <Dialog title={mode === 'new' ? 'New project' : 'Save as'} onClose={onClose}><form className="settings-form" onSubmit={event => {
    event.preventDefault(); const parsed = projectActionSchema.safeParse({action: mode, name, revision: original.revision, ...(mode === 'new' ? {settings} : {})});
    if(!parsed.success) {setError(parsed.error.issues[0].message); return;}
    void useEditor.getState().manageProject(parsed.data, original.revision).then(ok => {if(ok) onClose();});
  }}><p className="settings-description">{mode === 'new' ? 'A fresh timeline and media library. Your other projects stay saved.' : 'Save a separate copy of this timeline, media list and settings, then continue editing the copy.'}</p><Field label="Project name"><input autoFocus aria-label="Project name" value={name} maxLength={120} required onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)}/></Field>{mode === 'new' && <ResolutionFields value={settings} onChange={patch => setSettings({...settings, ...patch})}/>}<p className="field-help">{mode === 'new' ? 'Reusable Asset Studio presets are available in every project.' : 'The original stays in Open project. Further edits and undo history are independent.'}</p>{(error || mutationError) && <p role="alert" className="agent-inline-error">{error || mutationError}</p>}<div className="settings-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{mode === 'new' ? 'Create project' : 'Save copy'}</Button></div></form></Dialog>;
}
