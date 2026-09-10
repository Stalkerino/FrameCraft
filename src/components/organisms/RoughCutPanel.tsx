import {useEffect, useState} from 'react';
import {ArrowDown, ArrowUp, Clapperboard, Play, Trash2} from 'lucide-react';
import type {RoughCutShot} from '../../../shared/assisted-editing';
import {formatTime} from '../../../shared/project';
import {useEditor} from '../../stores/editor-store';
import {useAnalysis} from '../../stores/analysis-store';
import {analysisApi} from '../../services/analysis-api';
import {useAssistAction} from '../../hooks/use-assist-action';
import {Button, IconButton} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {AnalysisProgress} from '../molecules/AnalysisProgress';
import {SourcePreview} from '../molecules/SourcePreview';
export function RoughCutPanel() {
  const project = useEditor(s => s.snapshot?.project); const jobs = useAnalysis(s => s.jobs); const jobId = useAnalysis(s => s.roughcutId); const job = jobs.find(j => j.id === jobId);
  const [assetIds, setAssetIds] = useState<string[]>([]); const [topic, setTopic] = useState(''); const [seconds, setSeconds] = useState(60);
  const [shots, setShots] = useState<RoughCutShot[]>([]); const [title, setTitle] = useState(''); const [addTitle, setAddTitle] = useState(true); const [mode, setMode] = useState<'append' | 'replace'>('append'); const [preview, setPreview] = useState<RoughCutShot | null>(null); const [applied, setApplied] = useState(false);
  const {busy, run} = useAssistAction(); const proposal = job?.proposal;
  useEffect(() => {if(job?.status === 'done' && job.proposal) {setShots(job.proposal.shots); setTitle(job.proposal.title); setApplied(false); setPreview(null);}}, [job?.id, job?.status]);
  if(!project) return null;
  const fps = project.fps;
  const active = job?.status === 'running' || job?.status === 'queued'; const stale = proposal && proposal.revision !== project.revision;
  const previewAsset = project.assets.find(a => a.id === preview?.assetId);
  const move = (index: number, offset: number) => {const next = [...shots]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setShots(next);};
  return <div className="assist-section">
    <div className="assist-section-title"><strong>Choose your sources</strong><button onClick={() => setAssetIds(project.assets.map(a => a.id))}>Select all</button></div>
    <div className="source-checklist">{project.assets.map(asset => <label key={asset.id}><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={e => setAssetIds(e.target.checked ? [...assetIds, asset.id] : assetIds.filter(id => id !== asset.id))}/><span>{asset.name}<small>{asset.kind} · {formatTime(Math.floor(asset.duration * fps), fps)}</small></span></label>)}</div>
    <Field label="What is this devlog about?"><textarea aria-label="First cut topic" placeholder="Optional · the new combat system" rows={2} value={topic} maxLength={500} onChange={e => setTopic(e.target.value)}/></Field>
    <Field label="Target duration (seconds)"><input aria-label="First cut duration" type="number" min={5} max={3600} value={seconds} onChange={e => setSeconds(Number(e.target.value))}/></Field>
    <Button icon={<Clapperboard size={15}/>} disabled={busy || active || !assetIds.length || seconds < 5 || seconds > 3600} onClick={() => void run(async () => {const next = await analysisApi.roughcut(assetIds.filter(id => project.assets.some(a => a.id === id)), seconds, topic); useAnalysis.getState().add(next); useAnalysis.setState({roughcutId: next.id});})}>Propose a first cut</Button>
    <p className="field-help">Selects spoken passages, then keeps their source order. A topic ranks passages by meaning. Without a transcript, the opening seconds are used. For footage without speech, use Automatic Cuts for visual review with Codex.</p>
    <AnalysisProgress job={job}/>
    {proposal && <>
      {previewAsset && preview && <SourcePreview asset={previewAsset} start={preview.sourceStart / fps} end={(preview.sourceStart + preview.duration) / fps}/>}
      <div className="assist-section-title"><strong>{shots.length} shots</strong><span>{formatTime(shots.reduce((n, shot) => n + shot.duration, 0), fps)} total</span></div>
      {proposal.warnings.map(warning => <p className="field-help" key={warning}>{warning}</p>)}
      <ol className="roughcut-shots">{shots.map((shot, index) => <li key={`${shot.assetId}:${shot.sourceStart}:${index}`}><span className="shot-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{project.assets.find(a => a.id === shot.assetId)?.name}</strong><p>{shot.text || shot.reason}</p><small>{formatTime(shot.sourceStart, fps)} · {(shot.duration / fps).toFixed(1)} s</small><div className="shot-actions"><IconButton label={`Preview shot ${index + 1}`} onClick={() => setPreview(shot)}><Play size={13}/></IconButton><IconButton label={`Move shot ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13}/></IconButton><IconButton label={`Move shot ${index + 1} down`} disabled={index === shots.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13}/></IconButton><IconButton label={`Remove shot ${index + 1}`} onClick={() => setShots(shots.filter((_, i) => i !== index))}><Trash2 size={13}/></IconButton></div></div></li>)}</ol>
      <Field label="Opening title"><input aria-label="First cut title" value={title} maxLength={120} onChange={e => setTitle(e.target.value)}/></Field><label className="assist-checkbox"><input type="checkbox" checked={addTitle} onChange={e => setAddTitle(e.target.checked)}/> Add title overlay</label>
      <Field label="Apply to timeline"><select aria-label="First cut apply mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="append">Append after existing clips</option><option value="replace">Replace timeline clips</option></select></Field>
      {mode === 'replace' && <p className="field-help">Replaces all timeline clips. Imported media stay available; Undo restores the previous timeline.</p>}
      {stale && !applied && <p className="field-help">The timeline changed. Generate a fresh proposal before applying.</p>}
      <Button variant="primary" disabled={busy || !shots.length || !!stale || applied} onClick={() => void run(async () => {useEditor.getState().accept(await analysisApi.applyRoughcut(proposal.revision, mode, shots, title, addTitle)); setApplied(true);})}>{applied ? 'Applied to timeline' : 'Apply this cut'}</Button>
    </>}
  </div>;
}
