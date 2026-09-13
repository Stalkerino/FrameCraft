import {useState} from 'react';
import type {ProjectCareController} from '../../hooks/useProjectCare';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function RelinkMediaPanel({care}: {care: ProjectCareController}) {
  const [selected, setSelected] = useState(''); const [filePath, setFilePath] = useState(''); const [onlyMissing, setOnlyMissing] = useState(false);
  const missing = care.media?.media.filter(item => item.status !== 'available').length ?? 0;
  const entries = care.media?.media.filter(item => !onlyMissing || item.status !== 'available');
  return <section className="project-care__section" aria-label="Project media files">
    <div className="project-care__toolbar"><p>{care.media ? `${missing} unavailable · ${care.media.media.length} media references` : 'Checking files…'}</p><Button disabled={care.busy} onClick={() => void care.refresh()}>Check files</Button></div>
    <label><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)}/> Show unavailable only</label>
    <div className="project-care__list">{entries?.map(item => <article key={item.assetId} className={item.status !== 'available' ? 'project-care__missing' : ''}>
      <div><strong>{item.name}</strong><small>{item.kind} · {item.status}</small><small className="project-care__path">{item.filePath || item.src}</small></div>
      <Button disabled={care.busy} onClick={() => {setSelected(item.assetId); setFilePath('');}}>Choose replacement</Button>
    </article>)}</div>
    {selected && <div className="project-care__replacement"><strong>Replace {care.media?.media.find(item => item.assetId === selected)?.name}</strong>
      <p>The file is copied into this project. Cuts, timing and effects are preserved; shared audio/video references update together. A source too short for your cuts is rejected. Undo restores the old references.</p>
      <Field label="Replacement file path"><input value={filePath} placeholder="Absolute path on this computer" onChange={e => setFilePath(e.target.value)}/></Field>
      <Button variant="primary" disabled={care.busy || !filePath.trim()} onClick={() => void care.relink(selected, filePath.trim())}>Replace media</Button>
    </div>}
  </section>;
}
