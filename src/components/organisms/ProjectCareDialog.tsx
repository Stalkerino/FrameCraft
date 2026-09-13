import {useState} from 'react';
import {useProjectCare} from '../../hooks/useProjectCare';
import {Dialog} from '../atoms/Dialog';
import {RecoveryPanel} from '../molecules/RecoveryPanel';
import {RelinkMediaPanel} from '../molecules/RelinkMediaPanel';
import {ProjectTransferPanel} from '../molecules/ProjectTransferPanel';
import {useEditor} from '../../stores/editor-store';
export function ProjectCareDialog({onClose}: {onClose: () => void}) {
  const care = useProjectCare(); const [tab, setTab] = useState('Recovery');
  const recoveryNotice = useEditor(state => state.snapshot?.recoveryNotice);
  return <Dialog title="Project safety & portability" onClose={onClose}><div className="project-care">
    <nav aria-label="Project safety sections">{['Recovery', 'Media files', 'Portable project'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
    {recoveryNotice && <p role="status">{recoveryNotice}</p>}
    {care.error && <p role="alert" className="agent-inline-error">{care.error}</p>}
    {care.busy && <p role="status">Working…</p>}
    {tab === 'Recovery' ? <RecoveryPanel care={care}/> : tab === 'Media files' ? <RelinkMediaPanel care={care}/> : <ProjectTransferPanel care={care}/>}
  </div></Dialog>;
}
