import {Download, FolderOpen, Play} from 'lucide-react';
import {useState} from 'react';
import type {RenderJob} from '../../../shared/project';
import {desktopApi} from '../../services/desktop-api';

export function RenderOutputActions({job}: {job: RenderJob}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if(!job.url || job.status !== 'done') return null;
  const kind = job.kind === 'video' ? 'video' : 'frame';
  if(!desktopApi.available()) return <a className="download-link" href={job.url} download={job.filename || `framecraft-${kind}.${kind === 'video' ? 'mp4' : 'png'}`}><Download size={14}/> Download {kind}</a>;
  const open = async (folder: boolean) => {
    setBusy(true); setError('');
    try {await desktopApi.openRender(job.id, folder);} catch(e) {setError(String(e instanceof Error ? e.message : e));}
    finally {setBusy(false);}
  };
  return <><div className="render-output-actions">
    <button className="download-link" disabled={busy} onClick={() => void open(false)}><Play size={14}/> Open {kind}</button>
    <button className="download-link" disabled={busy} onClick={() => void open(true)}><FolderOpen size={14}/> Open export folder</button>
  </div>{error && <p className="render-output-actions__error" role="alert">{error}</p>}</>;
}
