import {useState} from 'react';
import type {ProjectCareController} from '../../hooks/useProjectCare';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function ProjectTransferPanel({care}: {care: ProjectCareController}) {
  const [directory, setDirectory] = useState(''); const [kind, setKind] = useState<'export' | 'import'>('export');
  return <section className="project-care__section" aria-label="Portable projects">
    <p>Copy the project and all its imported media, including generated sounds and embedded animation/transition recipes. Original quality is preserved. Proxies regenerate on the destination computer; unused global library presets and past exports are not included.</p>
    <Field label="Transfer action"><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="export">Create portable folder</option><option value="import">Import portable folder</option></select></Field>
    <Field label="Portable project folder"><input value={directory} placeholder="Absolute folder path on this computer" onChange={e => setDirectory(e.target.value)}/></Field>
    <p>{kind === 'export' ? 'Choose a new folder name. Existing folders are never overwritten. Transfer continues if you close this dialog.' : 'Choose the folder containing framecraft-project.json. A separate saved project is created; your current timeline stays open.'}</p>
    <Button variant="primary" disabled={care.busy || !directory.trim()} onClick={() => void care.transfer(kind, directory.trim())}>{kind === 'export' ? 'Create portable project' : 'Import portable project'}</Button>
    <div className="project-care__list">{[...care.jobs].reverse().map(job => <article key={job.id}>
      <div><strong>{job.kind === 'export' ? 'Package' : 'Import'} · {job.status}</strong><small className="project-care__path">{job.directory}</small>
        <small>{job.files}/{job.totalFiles} files · {(job.bytes / 1024 ** 2).toFixed(1)} / {(job.totalBytes / 1024 ** 2).toFixed(1)} MB</small>
        {['queued', 'copying'].includes(job.status) && <progress aria-label="Project transfer progress" max={1} value={job.progress}/>}
        {job.error && <small role="alert">{job.error}</small>}
        {['error', 'cancelled'].includes(job.status) && <small>Partial copies may remain. Retry packaging into a new folder.</small>}
        {job.status === 'done' && job.kind === 'export' && <small>Ready to move to another computer.</small>}
      </div>
      {['queued', 'copying'].includes(job.status) && <Button disabled={care.busy} onClick={() => void care.cancel(job.id)}>Cancel</Button>}
      {job.kind === 'import' && job.status === 'done' && <Button onClick={() => {const state = useEditor.getState(); if(state.snapshot) void state.manageProject({action: 'open', id: job.projectId}, state.snapshot.project.revision);}}>Open imported project</Button>}
    </article>)}</div>
  </section>;
}
