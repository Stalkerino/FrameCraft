import {useState} from 'react';
import {Eye, ScanLine, Sparkles} from 'lucide-react';
import {sourceTimecode, type VideoSheet} from '../../../shared/visual-rush';
import {useEditor} from '../../stores/editor-store';
import {useAnalysis} from '../../stores/analysis-store';
import {useVisualRush} from '../../hooks/useVisualRush';
import {useAssistAction} from '../../hooks/use-assist-action';
import {visualRushApi} from '../../services/visual-rush-api';
import {generateGameplayInCodex, reviewGameplayInCodex, type GameplayResult} from '../../services/gameplay-prompt-service';
import {useAgent} from '../../stores/agent-store';
import {projectTracks} from '../../../shared/tracks';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {AnalysisProgress} from '../molecules/AnalysisProgress';
import {SourcePreview} from '../molecules/SourcePreview';
import {VideoCutReview} from '../molecules/VideoCutReview';
export function GameplayPanel() {
  const project = useEditor(s => s.snapshot?.project); const jobs = useAnalysis(s => s.jobs); const {reports, cuts, error} = useVisualRush(project?.id); const {busy, run} = useAssistAction();
  const chosen = useAnalysis(s => s.assetId); const selectedTrackId = useEditor(s => s.selectedTrackId);
  const agentStatus = useAgent(s => s.session.status); const agentPending = useAgent(s => s.pending); const agentError = useAgent(s => s.error);
  const [mode, setMode] = useState<GameplayResult>('apply'); const [destination, setDestination] = useState('');
  const [goal, setGoal] = useState(''); const [seconds, setSeconds] = useState(60); const [sheet, setSheet] = useState<VideoSheet | null>(null); const [preview, setPreview] = useState<number | null>(null);
  if(!project) return null; const videos = project.assets.filter(asset => asset.kind === 'video'); const asset = videos.find(asset => asset.id === chosen) ?? videos[0]; const report = reports.find(report => report.assetId === asset?.id); const cut = cuts.find(cut => cut.assetId === asset?.id);
  const job = [...jobs].reverse().find(job => job.kind === 'visual-scan' && job.assetId === asset?.id); const active = job?.status === 'queued' || job?.status === 'running';
  const tracks = projectTracks(project).filter(t => t.type === 'visual');
  const trackId = tracks.find(t => t.id === destination)?.id ?? tracks.find(t => t.id === selectedTrackId)?.id ?? tracks[0]?.id ?? '';
  const generating = agentPending || agentStatus === 'working' || agentStatus === 'starting';
  return <div className="assist-section"><div className="assist-hint"><Eye size={22}/><strong>Automatic Cuts</strong><p>Tell Codex what to keep. It inspects the recording and creates cuts through the existing chat. Works with gameplay, devlogs, demonstrations and other footage. No narration needed.</p></div>{!asset ? <p className="field-help">Import a video to begin. No speech or transcription is needed.</p> : <>
    <Field label="Video source"><select aria-label="Video source" value={asset.id} onChange={event => {useAnalysis.setState({assetId: event.target.value}); setSheet(null); setPreview(null);}}>{videos.map(video => <option key={video.id} value={video.id}>{video.name}</option>)}</select></Field><Field label="What should the edit show?"><textarea aria-label="Automatic Cuts editing goal" rows={3} placeholder="Show the key moments and final result. Keep complete demonstrations; skip waiting and repeated attempts." value={goal} onChange={event => setGoal(event.target.value)}/></Field><Field label="Target length (seconds)"><input aria-label="Automatic Cuts target duration" type="number" min={5} value={seconds} onChange={event => setSeconds(Number(event.target.value))}/></Field>
    <Field label="AI result"><select aria-label="Automatic Cuts AI result" value={mode} onChange={event => setMode(event.target.value as GameplayResult)}><option value="apply">Generate and apply cuts</option><option value="review">Generate a proposal for review</option></select></Field>
    {mode === 'apply' && <><Field label="Replace clips on video track"><select aria-label="AI cut destination track" value={trackId} onChange={event => setDestination(event.target.value)}>{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field><p className="field-help">Replaces clips on this video track. Other tracks keep their timing. Original footage stays available; Undo restores the previous edit.</p></>}
    <Button variant="primary" icon={<Sparkles size={15}/>} disabled={busy || generating || active || !Number.isFinite(seconds) || seconds < 5 || (mode === 'apply' && !trackId)} onClick={() => void run(async () => {await generateGameplayInCodex(asset.id, goal, seconds, mode, trackId, report);})}>{mode === 'apply' ? 'Generate and apply cuts' : 'Generate cut proposal'}</Button>
    <p className="field-help">Starts or resumes your existing Codex session and sends the request immediately. Follow its analysis, approvals and answers in the chat. This uses your Codex account.</p>{generating && <p role="status" className="field-help">Codex is working — follow progress in the right-hand chat.</p>}{agentError && <p role="alert" className="agent-inline-error">{agentError}</p>}
    <div className="assist-section-title"><strong>Optional: inspect footage yourself</strong></div><p className="field-help">Scan creates a visual map only. Use Generate above to have Codex choose and create the cuts.</p>
    <Button icon={<ScanLine size={15}/>} disabled={busy || active} onClick={() => void run(async () => {useAnalysis.getState().add(await visualRushApi.analyze(asset.id, !!report)); setSheet(null);})}>{report ? 'Rescan video' : 'Scan video'}</Button><AnalysisProgress job={job}/>{error && <p role="alert" className="agent-inline-error">{error}</p>}
    {report && <div className="gameplay-map"><div className="assist-section-title"><strong>Visual map ready</strong><span>{report.moments.length} moments</span></div><p className="field-help">{report.cues.filter(c => c.kind === 'low-motion').length} low-motion stretches · {report.cues.filter(c => c.kind === 'visual-change').length} large visual changes. These are inspection cues, not automatic cut decisions.</p><div className="gameplay-pages">{Array.from({length: Math.ceil(report.moments.length / 12)}, (_, page) => <Button key={page} disabled={busy} onClick={() => void run(async () => setSheet(await visualRushApi.inspect({reportId: report.id, page})))}>Frames {page * 12 + 1}–{Math.min(report.moments.length, (page + 1) * 12)}</Button>)}</div>{sheet && <><img className="gameplay-sheet" src={sheet.url} alt="Video frames in timestamp order, left to right then top to bottom"/><div className="gameplay-timestamps">{sheet.frames.map(frame => <button key={frame.index} onClick={() => setPreview(frame.time)}>{frame.index}. {sourceTimecode(frame.time)}</button>)}</div></>}</div>}
    {preview !== null && <SourcePreview asset={asset} start={preview} end={Math.min(asset.duration, preview + 8)}/>}<Button icon={<Sparkles size={15}/>} disabled={active || !Number.isFinite(seconds) || seconds < 5} onClick={() => reviewGameplayInCodex(asset.id, goal, seconds, report)}>Review in Codex</Button><p className="field-help">Opens a request in your existing Codex chat. Send it there to start visual review. Source frames are sampled; short events need closer inspection.</p>
    {cut && <VideoCutReview key={`${cut.id}:${cut.version}`} cut={cut} project={project} asset={asset}/>}
  </>}</div>;
}
