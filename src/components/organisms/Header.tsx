import {Check, Download, FileCode2, FilePlus2, FolderOpen, LoaderCircle, Settings2} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button} from '../atoms/Button';
import {ProjectSettingsDialog} from './ProjectSettingsDialog';
import {ExportDialog} from './ExportDialog';
import {useEditor} from '../../stores/editor-store';
import {ProjectMenu} from '../molecules/ProjectMenu';
import {ProjectBrowserDialog} from './ProjectBrowserDialog';
import {CreateProjectDialog} from './CreateProjectDialog';
import {TimelineExportDialog} from './TimelineExportDialog';
export function Header() {
  const snapshot = useEditor(s => s.snapshot); const connected = useEditor(s => s.connected); const busy = useEditor(s => s.busy);
  const [editing, setEditing] = useState(false);
  const [settingsDialog, setSettingsDialog] = useState(false); const [exportDialog, setExportDialog] = useState(false);
  const [timelineExportDialog, setTimelineExportDialog] = useState(false);
  const [clearDialog, setClearDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState<'new' | 'copy' | 'open' | null>(null);
  useEffect(() => {setProjectDialog(null); setSettingsDialog(false); setExportDialog(false); setTimelineExportDialog(false); setClearDialog(false); setEditing(false);}, [snapshot?.project.id]);
  const openProjects = (mode: 'new' | 'copy' | 'open') => {useEditor.setState({error: null, playing: false}); setProjectDialog(mode);};
  const job = useEditor(s => s.renderJob); const exporting = job && ['queued', 'rendering'].includes(job.status);
  return <header className="topbar">
    <div className="brand" aria-label="Framecraft Studio"><span className="brand__mark">f<span/></span><span>framecraft<span className="brand__suffix">studio</span></span></div>
    <div className="project-title"><FolderOpen size={15}/><div className="project-title__content">{editing ? <input autoFocus aria-label="Project name" defaultValue={snapshot?.project.name} maxLength={120} onBlur={e => {const name = e.target.value.trim(); if(name && name !== snapshot?.project.name) void useEditor.getState().execute([{type: 'project.rename', name}], 'Renamed project'); setEditing(false);}} onKeyDown={e => {if(e.key === 'Enter') e.currentTarget.blur();}}/> : <ProjectMenu key={snapshot?.project.id} name={snapshot?.project.name || 'Opening project'} disabled={!snapshot || busy} onNew={() => openProjects('new')} onOpen={() => openProjects('open')} onCopy={() => openProjects('copy')} onRename={() => setEditing(true)} onClear={() => setClearDialog(true)}/>}<span className="project-title__meta">{snapshot ? `${snapshot.project.width} × ${snapshot.project.height} · ${snapshot.project.fps} fps` : 'Local project'}</span></div></div>
    <div className="topbar__actions"><span className={`save-status ${!connected ? 'save-status--offline' : ''}`}>{busy ? <LoaderCircle className="spin" size={13}/> : <Check size={13}/>}<span>{!connected ? 'Connecting…' : busy ? 'Saving…' : 'All changes saved'}</span></span>
      <Button className="topbar__settings" icon={<Settings2 size={15}/>} disabled={!snapshot || busy} onClick={() => setSettingsDialog(true)}>Project settings</Button>
      <Button icon={<FileCode2 size={15}/>} disabled={!snapshot?.project.clips.length || busy} onClick={() => {useEditor.setState({playing: false}); setTimelineExportDialog(true);}}>Export timeline</Button>
      <Button variant="primary" icon={exporting ? <LoaderCircle size={15} className="spin"/> : <Download size={15}/>} disabled={!!exporting || !snapshot?.project.clips.length} onClick={() => setExportDialog(true)}>{exporting ? `Exporting ${Math.round(job.progress * 100)}%` : 'Export video'}</Button>
    </div>{snapshot && timelineExportDialog && <TimelineExportDialog project={snapshot.project} onClose={() => setTimelineExportDialog(false)}/>} {snapshot && projectDialog === 'open' && <ProjectBrowserDialog onClose={() => setProjectDialog(null)} onNew={() => openProjects('new')}/>} {snapshot && (projectDialog === 'new' || projectDialog === 'copy') && <CreateProjectDialog key={projectDialog} mode={projectDialog} onClose={() => setProjectDialog(null)}/>} {snapshot && settingsDialog && <ProjectSettingsDialog project={snapshot.project} onClose={() => setSettingsDialog(false)}/>} {snapshot && exportDialog && <ExportDialog project={snapshot.project} onClose={() => setExportDialog(false)}/>} {clearDialog && <div className="modal-backdrop" onKeyDown={e => {if(e.key === 'Escape') setClearDialog(false);}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="clear-heading"><FilePlus2 size={25}/><h3 id="clear-heading">Clear this timeline?</h3><p>Your imported media stays in this project, and you can undo this. To keep another version, choose Save as from the project menu first.</p><div><Button autoFocus onClick={() => setClearDialog(false)}>Keep editing</Button><Button variant="primary" onClick={() => {void useEditor.getState().execute([{type: 'project.clear'}], 'Started a blank timeline').then(ok => {if(ok) {useEditor.setState({selectedId: null}); useEditor.getState().seekTo(0);}}); setClearDialog(false);}}>Clear timeline</Button></div></div></div>}
  </header>;
}
