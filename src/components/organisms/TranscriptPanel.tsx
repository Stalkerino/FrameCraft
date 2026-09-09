import {useEffect, useState} from 'react';
import {Captions, Scissors, Mic, Save} from 'lucide-react';
import type {Transcript} from '../../../shared/transcript';
import type {CaptionOptions} from '../../../shared/assisted-editing';
import {formatTime} from '../../../shared/project';
import {analysisApi, type CutInput, type CutPreview} from '../../services/analysis-api';
import {useAnalysis} from '../../stores/analysis-store';
import {useEditor} from '../../stores/editor-store';
import {useAssistAction} from '../../hooks/use-assist-action';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {AnalysisProgress} from '../molecules/AnalysisProgress';
import {SourcePreview} from '../molecules/SourcePreview';

export function TranscriptPanel() {
  const project = useEditor(s => s.snapshot?.project); const selectedId = useEditor(s => s.selectedId); const frame = useEditor(s => s.frame);
  const assetId = useAnalysis(s => s.assetId); const jobs = useAnalysis(s => s.jobs);
  const [doc, setDoc] = useState<Transcript | null>(null); const [loading, setLoading] = useState(false); const [language, setLanguage] = useState('auto');
  const [selected, setSelected] = useState<string[]>([]); const [anchor, setAnchor] = useState<string | null>(null); const [correction, setCorrection] = useState('');
  const [preview, setPreview] = useState<(CutPreview & {input: CutInput}) | null>(null); const [sourceTime, setSourceTime] = useState(0);
  const [style, setStyle] = useState<CaptionOptions['style']>('highlight'); const {busy, run} = useAssistAction();
  const fps = project?.fps ?? 30;
  const asset = project?.assets.find(a => a.id === assetId); const clip = project?.clips.find(c => c.id === selectedId && c.assetId === assetId && ['video', 'audio'].includes(c.kind));
  const job = jobs.filter(j => j.assetId === assetId).at(-1); const completed = job?.status === 'done' ? job.id : '';
  const analyzing = job?.status === 'running' || job?.status === 'queued';
  useEffect(() => {
    let cancelled = false; setDoc(null); setSelected([]); setPreview(null); setSourceTime(0);
    if(!assetId) return;
    setLoading(true); analysisApi.transcript(assetId).then(value => {if(!cancelled) setDoc(value);}).catch(error => {if(!cancelled) useEditor.setState({error: error.message});}).finally(() => {if(!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [assetId, completed]);
  useEffect(() => setPreview(null), [project?.revision, selectedId, selected]);
  const words = doc?.words.filter(w => !clip || w.end * fps > clip.sourceStart && w.start * fps < clip.sourceStart + clip.duration) ?? [];
  const choose = (id: string, shift: boolean) => {
    const word = words.find(w => w.id === id)!;
    if(shift && anchor && words.some(w => w.id === anchor)) {const a = words.findIndex(w => w.id === anchor); const b = words.findIndex(w => w.id === id); setSelected(words.slice(Math.min(a, b), Math.max(a, b) + 1).map(w => w.id));}
    else {setSelected([id]); setAnchor(id); setCorrection(word.text);}
    setSourceTime(word.start);
    if(clip) useEditor.getState().seekTo(Math.max(clip.start, clip.start + Math.floor(word.start * fps) - clip.sourceStart));
  };
  if(!project) return null;
  return <div className="assist-section">
    <Field label="Speech source"><select aria-label="Speech source" value={assetId} onChange={e => useAnalysis.setState({assetId: e.target.value})}><option value="">Choose a video or audio file</option>{project.assets.filter(a => a.kind !== 'image').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
    {asset && <>
      <SourcePreview asset={asset} start={sourceTime}/>
      <div className="assist-inline"><select aria-label="Transcription language" value={language} onChange={e => setLanguage(e.target.value)}><option value="auto">Detect language</option><option value="french">Français</option><option value="english">English</option></select><Button disabled={busy || analyzing || loading} icon={<Mic size={14}/>} onClick={() => void run(async () => useAnalysis.getState().add(await analysisApi.transcribe(assetId, language, doc?.revision ?? null)))}>{doc ? 'Transcribe again' : 'Transcribe'}</Button></div>
      <AnalysisProgress job={job}/>
      {loading && <p className="field-help">Loading transcript…</p>}
      {doc && <>
        <Field label="Edit on timeline"><select aria-label="Transcript timeline clip" value={clip?.id ?? ''} onChange={e => useEditor.setState({selectedId: e.target.value || null})}><option value="">Source transcript only</option>{project.clips.filter(c => c.assetId === assetId && ['video', 'audio'].includes(c.kind)).map(c => <option key={c.id} value={c.id}>{c.name} · {formatTime(c.start, fps)}</option>)}</select></Field>
        <div className="assist-section-title"><span>{words.length} words {clip ? 'in this clip' : 'in source'}</span><button onClick={() => setSelected(words.map(w => w.id))}>Select all</button></div>
        <p className="field-help">Click a word to seek. Shift-click selects a passage.</p>
        <div className="transcript-words" aria-label="Transcript words">{words.map(word => <button key={word.id} title={`${word.start.toFixed(2)} – ${word.end.toFixed(2)} s`} aria-pressed={selected.includes(word.id)} className={`${selected.includes(word.id) ? 'selected' : ''} ${clip && (frame - clip.start + clip.sourceStart) / fps >= word.start && (frame - clip.start + clip.sourceStart) / fps < word.end ? 'speaking' : ''}`} onClick={e => choose(word.id, e.shiftKey)}>{word.text}</button>)}</div>
        {selected.length === 1 && <div className="assist-inline"><input aria-label="Correct selected word" value={correction} maxLength={300} onChange={e => setCorrection(e.target.value)}/><button aria-label="Save word correction" disabled={busy || !correction.trim()} onClick={() => void run(async () => {const updated = await analysisApi.saveTranscript({...doc, words: doc.words.map(w => w.id === selected[0] ? {...w, text: correction.trim()} : w)}); setDoc(updated); setPreview(null);})}><Save size={16}/></button></div>}
        <Button disabled={busy || !clip || !selected.length} icon={<Scissors size={14}/>} onClick={() => void run(async () => {const input = {revision: project.revision, transcriptRevision: doc.revision, clipId: clip!.id, wordIds: selected}; setPreview({...await analysisApi.previewCut(input), input});})}>Review cut · {selected.length} words</Button>
        {preview && <div className="assist-review"><strong>Remove {(preview.removedFrames / fps).toFixed(2)} s</strong><p>{preview.affectedClips} clips affected. All tracks close the gap together.</p><Button disabled={busy} onClick={() => void run(async () => {useEditor.getState().accept(await analysisApi.applyCut(preview.input)); setPreview(null); setSelected([]);})}>Apply cut</Button></div>}
        <div className="assist-divider"/>
        <div className="assist-section-title"><Captions size={16}/><strong>Captions</strong></div>
        <div className="caption-styles">{(['clean', 'highlight', 'boxed'] as const).map(value => <button key={value} aria-pressed={style === value} className={`caption-style caption-style--${value} ${style === value ? 'active' : ''}`} onClick={() => setStyle(value)}><span>Tell <b>your</b> story</span><small>{value}</small></button>)}</div>
        <Button disabled={busy || !clip} onClick={() => void run(async () => useEditor.getState().accept(await analysisApi.captions(project.revision, doc.revision, clip!.id, {style})))}>Generate captions for selected clip</Button>
        <p className="field-help">Regenerating replaces this clip’s generated captions. Correct words here before generating.</p>
        <div className="assist-links"><a href="/api/analysis/subtitles/srt" download>Download SRT</a><a href="/api/analysis/subtitles/vtt" download>Download VTT</a></div>
      </>}
    </>}
    {!doc && !loading && <div className="assist-hint"><Mic size={22}/><strong>Transcribe & create captions</strong><p>Transcribe an imported source, select a passage, then create captions or remove it from a timeline clip.</p><small>Runs on your computer. Speech models download on first use.</small></div>}
  </div>;
}
