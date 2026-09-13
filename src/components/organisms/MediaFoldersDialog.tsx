import {useState} from 'react';
import {folderOptions} from '../../../shared/project-organization';
import {useEditor} from '../../stores/editor-store';
import {createId} from '../../services/id-service';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {MediaFolderSelect} from '../molecules/MediaFolderSelect';
export function MediaFoldersDialog({onClose}: {onClose: () => void}) {
  const project = useEditor(s => s.snapshot?.project); const busy = useEditor(s => s.busy); const error = useEditor(s => s.error);
  const folders = project?.folders ?? []; const [selected, setSelected] = useState(''); const [name, setName] = useState(''); const [parent, setParent] = useState('');
  const save = async () => {
    const state = useEditor.getState();
    const ok = await state.execute([selected ? {type: 'folder.update', id: selected, patch: {name, parentId: parent || null}} : {type: 'folder.add', folder: {id: createId(), name, parentId: parent || null}}], selected ? 'Updated media folder' : 'Created media folder');
    if(ok) {setSelected(''); setName(''); setParent('');}
  };
  return <Dialog title="Media folders" onClose={onClose}><div className="organization-dialog">
    <p>Organize project videos, images and sounds. Use the folder selector beneath each media card to move it. Removing a folder moves its contents to its parent; files and timeline clips stay intact.</p>
    <div className="organization-list">{folderOptions(folders).map(folder => <div key={folder.id}>
      <button onClick={() => {const current = folders.find(f => f.id === folder.id)!; setSelected(folder.id); setName(current.name); setParent(current.parentId || '');}}>{folder.label}<small>{project?.assets.filter(a => a.folderId === folder.id).length} media</small></button>
      <Button disabled={busy} onClick={() => void useEditor.getState().execute([{type: 'folder.remove', id: folder.id}], 'Removed media folder').then(ok => {if(ok) {setSelected(''); setName(''); setParent('');}})}>Remove folder</Button>
    </div>)}</div>
    <form className="marker-editor" onSubmit={e => {e.preventDefault(); void save();}}><Field label="Folder name"><input required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></Field>
      <Field label="Parent folder"><MediaFolderSelect label="Parent folder" rootLabel="Top level" folders={folders} value={parent} onChange={setParent}/></Field>
      <div className="organization-actions"><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{selected ? 'Save folder' : 'Create folder'}</Button>{selected && <Button type="button" onClick={() => {setSelected(''); setName(''); setParent('');}}>New folder</Button>}</div>
    </form>{error && <p role="alert" className="agent-inline-error">{error}</p>}
  </div></Dialog>;
}
