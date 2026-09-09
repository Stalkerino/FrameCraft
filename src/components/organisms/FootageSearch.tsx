import {useState} from 'react';
import {Search, Plus, Play} from 'lucide-react';
import {clipSchema, formatTime} from '../../../shared/project';
import type {SearchHit} from '../../../shared/transcript';
import {useEditor} from '../../stores/editor-store';
import {useAnalysis} from '../../stores/analysis-store';
import {analysisApi} from '../../services/analysis-api';
import {createId} from '../../services/id-service';
import {useAssistAction} from '../../hooks/use-assist-action';
import {Button} from '../atoms/Button';
import {AnalysisProgress} from '../molecules/AnalysisProgress';
import {SourcePreview} from '../molecules/SourcePreview';
import {clipTrackId, projectTracks} from '../../../shared/tracks';
export function FootageSearch() {
  const [query, setQuery] = useState(''); const [preview, setPreview] = useState<SearchHit | null>(null);
  const {busy, run} = useAssistAction(); const project = useEditor(s => s.snapshot?.project);
  const jobs = useAnalysis(s => s.jobs); const id = useAnalysis(s => s.searchId); const job = jobs.find(j => j.id === id);
  const fps = project?.fps ?? 30;
  const asset = project?.assets.find(a => a.id === preview?.assetId);
  const add = (hit: SearchHit) => {
    const asset = project?.assets.find(a => a.id === hit.assetId); if(!project || !asset) return;
    const type = asset.kind === 'audio' ? 'audio' : 'visual'; const tracks = projectTracks(project);
    const target = tracks.find(t => t.id === useEditor.getState().selectedTrackId && t.type === type) ?? tracks.find(t => t.type === type);
    const start = Math.max(0, ...project.clips.filter(c => clipTrackId(project, c) === target?.id).map(c => c.start + c.duration));
    const sourceStart = Math.floor(hit.start * fps); const duration = Math.max(1, Math.min(Math.floor(asset.duration * fps), Math.ceil(hit.end * fps)) - sourceStart);
    const clip = clipSchema.parse({id: createId(), name: hit.text.slice(0, 100), kind: asset.kind, assetId: asset.id, track: asset.kind === 'audio' ? 'audio' : 'visual', trackId: target?.id, start, sourceStart, duration});
    void useEditor.getState().execute([{type: 'clip.add', clip}], 'Added a search result').then(ok => {if(ok) {useEditor.setState({selectedId: clip.id}); useEditor.getState().seekTo(start);}});
  };
  return <div className="assist-section">
    <form className="assist-search" onSubmit={e => {e.preventDefault(); void run(async () => {const job = await analysisApi.search(query); useAnalysis.getState().add(job); useAnalysis.setState({searchId: job.id});});}}><label htmlFor="semantic-query">Find a moment by meaning</label><textarea id="semantic-query" placeholder="The part where I explain the lighting bug…" value={query} onChange={e => setQuery(e.target.value)} rows={3} maxLength={500}/><Button icon={<Search size={14}/>} disabled={busy || !query.trim() || job?.status === 'running' || job?.status === 'queued'} type="submit">Search footage</Button></form>
    <p className="field-help">Searches spoken passages in any transcription language. Untranscribed media are matched by filename. The first search downloads a local model.</p>
    <AnalysisProgress job={job}/>
    {asset && preview && <SourcePreview asset={asset} start={preview.start} end={preview.end} seekKey={preview.id}/>}
    {job?.status === 'done' && <div className="assist-section-title">{job.results?.length ?? 0} passages · most relevant first</div>}
    <div className="search-results">{job?.results?.map(hit => <article className="search-result" key={`${hit.assetId}:${hit.id}`}><div className="assist-section-title"><span>{formatTime(Math.floor(hit.start * fps), fps)} → {formatTime(Math.ceil(hit.end * fps), fps)}</span><span className="match-badge">{hit.match === 'transcript' ? 'Speech' : 'Filename'}</span></div><p>{hit.text}</p><small>{hit.assetName}</small><div className="assist-inline"><Button icon={<Play size={12}/>} onClick={() => setPreview(hit)}>Preview</Button><Button icon={<Plus size={12}/>} onClick={() => add(hit)}>Add passage</Button></div></article>)}</div>
  </div>;
}
