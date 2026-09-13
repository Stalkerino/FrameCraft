import {AlertCircle, CheckCircle2, LoaderCircle, X} from 'lucide-react';
import {useEffect} from 'react';
import {useEditor} from '../../stores/editor-store';
import {IconButton} from '../atoms/Button';
import {RenderOutputActions} from '../molecules/RenderOutputActions';
export function Notifications() {
  const error = useEditor(s => s.error); const notice = useEditor(s => s.notice); const job = useEditor(s => s.renderJob);
  useEffect(() => {if(notice) {const timer = setTimeout(() => useEditor.setState({notice: null}), 6000); return () => clearTimeout(timer);}}, [notice]);
  return <div className="notifications" aria-live="polite">{(error || notice) && <div className={`toast ${error ? 'toast--error' : ''}`}><AlertCircle size={18}/><p>{error || notice}</p><IconButton label="Dismiss notification" onClick={() => useEditor.setState({error: null, notice: null})}><X size={15}/></IconButton></div>}{job && <div className={`toast render-toast ${job.status === 'error' ? 'toast--error' : ''}`}>
    {job.status === 'done' ? <CheckCircle2 size={20}/> : job.status === 'error' ? <AlertCircle size={20}/> : <LoaderCircle size={20} className="spin"/>}<div><strong>{job.status === 'done' ? job.kind === 'frame' ? 'Your frame is ready' : 'Your story is ready to share' : job.status === 'error' ? 'Render failed' : job.status === 'queued' ? 'Preparing your render…' : `${job.phase || 'Rendering'} · ${Math.round(job.progress * 100)}%`}</strong><p>{job.status === 'error' ? job.error : job.status === 'done' ? `Project revision ${job.revision} · ${job.kind === 'video' ? job.settings ? `${job.settings.width} × ${job.settings.height} · ${job.settings.fps} fps · ${job.settings.codec.toUpperCase()}` : 'Video' : 'PNG image'}` : job.detail || 'You can keep editing while this version renders.'}</p>{job.warning && <p className="render-warning">{job.warning}</p>}<RenderOutputActions key={job.id} job={job}/>{job.status === 'rendering' && <progress value={job.progress} max={1}/>}</div>{['done', 'error'].includes(job.status) && <IconButton label="Dismiss render status" onClick={() => useEditor.setState({renderJob: null})}><X size={15}/></IconButton>}
  </div>}</div>;
}
