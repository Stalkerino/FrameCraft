import {useState} from 'react';
import type {ProjectCareController} from '../../hooks/useProjectCare';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function RecoveryPanel({care}: {care: ProjectCareController}) {
  const [label, setLabel] = useState('');
  return <section className="project-care__section" aria-label="Recovery versions">
    <p>Automatic checkpoints are kept about once per minute while editing. Older versions are pruned after 30 checkpoints or 64 MB per project; the newest is always retained. A separate recovery copy protects the preceding saved state.</p>
    <div className="project-care__form"><Field label="Checkpoint name"><input value={label} maxLength={120} placeholder="Before the final cut" onChange={e => setLabel(e.target.value)}/></Field><Button disabled={care.busy} onClick={() => void care.checkpoint(label.trim() || 'Manual checkpoint')}>Save checkpoint</Button></div>
    <p>Restoring saves your current version first and can be undone.</p>
    <div className="project-care__list">{care.versions.map(version => <article key={version.id}>
      <div><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleString()} · Revision {version.revision} · {version.name}</small></div>
      <Button disabled={care.busy} onClick={() => void care.restore(version.id)}>Restore</Button>
    </article>)}</div>
    {!care.versions.length && <p>No checkpoints yet. Save one to protect this version.</p>}
  </section>;
}
