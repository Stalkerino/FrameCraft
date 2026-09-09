import {useState} from 'react';
import {FilePlus2, Search} from 'lucide-react';
import {useEditor} from '../../stores/editor-store';
import {useProjectCatalog} from '../../hooks/useProjectCatalog';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {ProjectCard} from '../molecules/ProjectCard';
export function ProjectBrowserDialog({onClose, onNew}: {onClose: () => void; onNew: () => void}) {
  const revision = useEditor(s => s.snapshot?.project.revision ?? 0); const busy = useEditor(s => s.busy); const mutationError = useEditor(s => s.error);
  const {catalog, error} = useProjectCatalog(revision); const [query, setQuery] = useState('');
  const projects = catalog?.projects.filter(project => project.name.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title="Open project" onClose={onClose}><div className="project-browser"><p className="settings-description">Pick up where you left off. Your current project is already saved.</p><div className="project-browser__toolbar"><div className="search-field"><Search size={14}/><input autoFocus aria-label="Search projects" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)}/></div><Button icon={<FilePlus2 size={14}/>} disabled={busy} onClick={onNew}>New project</Button></div>{(error || mutationError) && <p role="alert" className="agent-inline-error">{error || mutationError}</p>}<div className="project-browser__grid">{projects?.map(project => <ProjectCard key={project.id} project={project} active={project.id === catalog?.activeId} disabled={busy} onOpen={() => {void useEditor.getState().manageProject({action: 'open', id: project.id}, revision).then(ok => {if(ok) onClose();});}}/>)}</div>{!projects?.length && <p className="project-browser__empty">{catalog ? 'No matching projects.' : 'Loading saved projects…'}</p>}</div></Dialog>;
}
