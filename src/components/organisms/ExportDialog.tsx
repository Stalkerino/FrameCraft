import {activeSequenceName, sequenceAssets} from '../../../shared/project-sequences';
import {useMemo, useState} from 'react';
import {Player} from '@remotion/player';
import {Download, Film} from 'lucide-react';
import {audioCodecsFor, codecNames, exportSettingsSchema, extensionFor, recommendedVideoBitrate, type ExportSettings} from '../../../shared/media-settings';
import {initialExportPipeline} from '../../../shared/export-pipeline';
import {exportPreferences} from '../../services/export-preferences';
import {exportQualityPresets} from '../../../shared/output-quality';
import {durationOf, type Project} from '../../../shared/project';
import {reframeProject} from '../../../shared/project-settings';
import {ProjectComposition} from '../../video/ProjectComposition';
import {useEditor} from '../../stores/editor-store';
import {useMediaPlaybackSources} from '../../hooks/useMediaPlaybackSources';
import {Dialog} from '../atoms/Dialog';
import {Field} from '../atoms/Field';
import {Button} from '../atoms/Button';
import {ResolutionFields} from '../molecules/ResolutionFields';
import {EncoderSettings} from '../molecules/EncoderSettings';
import {RenderPlanSummary} from '../molecules/RenderPlanSummary';
import {SourceMatchControl} from '../molecules/SourceMatchControl';
import {SettingsSection} from '../molecules/SettingsSection';
import {nativeGpuPlan} from '../../../shared/native-gpu-plan';
import {nativeScenePlan} from '../../../shared/native-scene-plan';
import {useExportDestination} from '../../hooks/useExportDestination';
import {ExportDestination} from '../molecules/ExportDestination';

export function ExportDialog({project, onClose}: {project: Project; onClose: () => void}) {
  const [original] = useState(project);
  const [settings, setSettings] = useState<ExportSettings>(() => initialExportPipeline(project, exportPreferences.read(project.id)));
  const destination = useExportDestination(original.id, settings.codec);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const frame = useEditor(s => s.frame);
  const {sources, pendingPreviews, onSourceError} = useMediaPlaybackSources(sequenceAssets(original));
  const patch = (value: Partial<ExportSettings>) => setSettings(current => {
    const next = {...current, ...value};
    if(value.renderer !== undefined || value.encoder !== undefined) exportPreferences.save(original.id, next);
    return next;
  });
  const parsed = exportSettingsSchema.safeParse(settings);
  const nativeBlockers = useMemo(() => {
    if(settings.renderer === 'compatible') return [];
    const value = exportSettingsSchema.safeParse(settings);
    if(!value.success) return [];
    try {return (settings.renderer === 'native-vulkan' ? nativeScenePlan(original, value.data) : nativeGpuPlan(original, value.data)).blockers;} catch {return [];}
  }, [original, settings]);
  const duration = durationOf(original) / original.fps;
  const {preview, previewError} = useMemo(() => {
    try {return {preview: reframeProject(original, settings.fps), previewError: ''};}
    catch(error) {return {preview: null, previewError: (error as Error).message};}
  }, [original, settings.fps]);
  const inputProps = useMemo(() => preview ? {project: preview, previewSources: sources, pendingPreviews, onPreviewSourceError: onSourceError, output: {width: settings.width, height: settings.height, fit: settings.fit}} : null, [preview, sources, pendingPreviews, onSourceError, settings.width, settings.height, settings.fit]);
  const prores = settings.codec === 'prores';
  const extension = extensionFor(settings.codec);
  const recommendedBitrate = recommendedVideoBitrate(settings);
  const rangeDuration = Math.max(0, (settings.endSeconds ?? duration) - settings.startSeconds);
  const estimatedMb = settings.qualityMode === 'bitrate' && !prores ? (settings.videoBitrate + (settings.audio ? settings.audioBitrate / 1000 : 0)) * rangeDuration / 8 : null;
  const submit = async () => {
    if(!parsed.success) {setError(parsed.error.issues[0].message); return;}
    if(previewError) {setError(previewError); return;}
    if(nativeBlockers.length) {setError(nativeBlockers[0].message); return;}
    if(settings.startSeconds >= duration || (settings.endSeconds ?? duration) > duration + .000001) {setError('Choose an export range inside the timeline.'); return;}
    if(useEditor.getState().snapshot?.project.revision !== original.revision) {setError('The timeline changed. Reopen export settings to use the latest version.'); return;}
    setBusy(true);
    try {
      if(remember && !await useEditor.getState().execute([{type: 'project.export-settings', settings}], 'Saved project export preset', original.revision)) return;
      await useEditor.getState().render('video', settings, destination.outputPath || undefined);
      if(useEditor.getState().error) {setError(useEditor.getState().error!); return;}
      onClose();
    } finally {setBusy(false);}
  };
  return <Dialog title="Export settings" onClose={onClose}><form className="settings-form export-form" onSubmit={event => {event.preventDefault(); void submit();}}>
    <div className="export-preview">{preview && inputProps && parsed.success && <Player component={ProjectComposition} inputProps={inputProps} durationInFrames={durationOf(preview)} compositionWidth={settings.width} compositionHeight={settings.height} fps={settings.fps} initialFrame={Math.min(durationOf(preview) - 1, Math.round(frame / original.fps * settings.fps))} style={{height: 180, maxWidth: '100%', aspectRatio: `${settings.width}/${settings.height}`}} controls={false} clickToPlay={false} initiallyMuted acknowledgeRemotionLicense/>}
      <div className="export-summary"><Film size={17}/><span>{activeSequenceName(original)}</span><strong>{settings.width} × {settings.height}</strong><span>{settings.fps} fps</span><span>{extension.toUpperCase()}</span><span>{rangeDuration.toFixed(1)} s</span>{estimatedMb !== null && <span>≈ {estimatedMb.toFixed(0)} MB</span>}</div>
    </div>
    <ExportDestination destination={destination}/>
    <SettingsSection title="Processing engine" description="Choose how video is decoded, composed and encoded.">
      <EncoderSettings settings={settings} onChange={patch}/>
      {nativeBlockers.length > 0 && <p role="alert" className="agent-inline-error">{nativeBlockers[0].clipName && `${nativeBlockers[0].clipName}: `}{nativeBlockers[0].message}{nativeBlockers.length > 1 && ` ${nativeBlockers.length - 1} more in Processing plan.`}</p>}
      {parsed.success && <RenderPlanSummary project={original} settings={parsed.data}/>}
    </SettingsSection>
    <SettingsSection title="Output resolution" description="Exports always read the original imported footage.">
      <SourceMatchControl project={original} value={settings} onChange={patch}/>
      <ResolutionFields value={settings} onChange={patch}/>
      <Field label="Aspect ratio handling"><select aria-label="Aspect ratio handling" value={settings.fit} onChange={event => patch({fit: event.target.value as ExportSettings['fit']})}><option value="contain">Fit · keep entire canvas</option><option value="cover">Fill · crop edges</option><option value="stretch">Stretch to output</option></select></Field>
    </SettingsSection>
    <SettingsSection title="Quality & format" description="Higher quality retains fine detail and creates larger files.">
      <Field label="Video codec / container"><select aria-label="Video codec / container" value={settings.codec} onChange={event => {const codec = event.target.value as ExportSettings['codec']; patch({codec, audioCodec: audioCodecsFor(codec)[0], crf: Math.max(codec === 'vp8' ? 4 : 1, Math.min(51, settings.crf))});}}>{codecNames.map(codec => <option key={codec} value={codec}>{codec === 'prores' ? 'Apple ProRes' : codec.toUpperCase()} · {extensionFor(codec).toUpperCase()}</option>)}</select></Field>
      {prores ? <Field label="ProRes profile"><select aria-label="ProRes profile" value={settings.proResProfile} onChange={event => patch({proResProfile: event.target.value as ExportSettings['proResProfile']})}>{['proxy', 'light', 'standard', 'hq', '4444', '4444-xq'].map(value => <option key={value}>{value}</option>)}</select></Field> : <>
        <div className="quality-presets" role="group" aria-label="Export quality presets">{exportQualityPresets.map(preset => <button type="button" key={preset.id} aria-pressed={settings.qualityMode === 'quality' && settings.crf === preset.crf} onClick={() => patch({qualityMode: 'quality', crf: preset.crf})}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div>
        <div className="settings-grid"><Field label="Rate control"><select aria-label="Rate control" value={settings.qualityMode} onChange={event => patch({qualityMode: event.target.value as ExportSettings['qualityMode']})}><option value="quality">Constant quality</option><option value="bitrate">Target bitrate</option></select></Field>
          {settings.qualityMode === 'quality' ? <Field label="Quality · lower is better"><input aria-label="CRF" type="number" min={settings.codec === 'vp8' ? 4 : ['h264', 'h264-mkv'].includes(settings.codec) ? 1 : 0} max={['h264', 'h265', 'h264-mkv'].includes(settings.codec) ? 51 : 63} value={settings.crf} onChange={event => patch({crf: Number(event.target.value)})}/></Field> : <Field label="Video bitrate (Mbps)"><input aria-label="Video bitrate (Mbps)" type="number" min={.1} max={500} step={.1} value={settings.videoBitrate} onChange={event => patch({videoBitrate: Number(event.target.value)})}/></Field>}
        </div>
        {settings.qualityMode === 'bitrate' && <div className="settings-bitrate-help"><p className="field-help">Suggested starting point for detailed gameplay at this resolution and frame rate: {recommendedBitrate} Mbps. Actual needs vary by footage and encoder.</p><Button type="button" onClick={() => patch({videoBitrate: recommendedBitrate})}>Use {recommendedBitrate} Mbps</Button></div>}
      </>}
    </SettingsSection>
    <details className="settings-disclosure"><summary>Audio <span>{settings.audio ? `${settings.audioCodec.toUpperCase()} · ${settings.sampleRate / 1000} kHz` : 'Muted'}</span></summary><div>
      <label className="settings-checkbox"><input type="checkbox" checked={settings.audio} onChange={event => patch({audio: event.target.checked})}/> Include audio</label>
      {settings.audio && <div className="settings-grid"><Field label="Audio codec"><select aria-label="Audio codec" value={settings.audioCodec} onChange={event => patch({audioCodec: event.target.value as ExportSettings['audioCodec']})}>{audioCodecsFor(settings.codec).map(codec => <option key={codec} value={codec}>{codec === 'pcm-16' ? 'PCM 16-bit' : codec.toUpperCase()}</option>)}</select></Field><Field label="Sample rate"><select aria-label="Sample rate" value={settings.sampleRate} onChange={event => patch({sampleRate: Number(event.target.value) as 44100 | 48000})}><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option></select></Field>{settings.audioCodec !== 'pcm-16' && <Field label="Audio bitrate (kbps)"><input aria-label="Audio bitrate (kbps)" type="number" min={32} max={512} value={settings.audioBitrate} onChange={event => patch({audioBitrate: Number(event.target.value)})}/></Field>}</div>}
    </div></details>
    <details className="settings-disclosure"><summary>Export range <span>{settings.startSeconds === 0 && settings.endSeconds === undefined ? 'Entire timeline' : `${settings.startSeconds.toFixed(2)}–${(settings.endSeconds ?? duration).toFixed(2)} s`}</span></summary><div>
      <div className="settings-grid"><Field label="Export start (seconds)"><input aria-label="Export start (seconds)" type="number" min={0} max={duration} step="any" value={settings.startSeconds} onChange={event => patch({startSeconds: Number(event.target.value)})}/></Field><Field label="Export end (seconds)"><input aria-label="Export end (seconds)" type="number" min={0} max={duration} step="any" placeholder={duration.toFixed(3)} value={settings.endSeconds ?? ''} onChange={event => patch({endSeconds: event.target.value === '' ? undefined : Number(event.target.value)})}/></Field></div>
      <Button type="button" onClick={() => patch({startSeconds: 0, endSeconds: undefined})}>Use entire timeline</Button>
    </div></details>
    <label className="settings-checkbox"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/> Remember these export settings for this project</label>
    {(error || (!parsed.success && parsed.error.issues[0].message) || previewError) && <p className="agent-inline-error" role="alert">{error || (!parsed.success && parsed.error.issues[0].message) || previewError}</p>}
    <div className="settings-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={<Download size={15}/>} disabled={busy || !parsed.success || nativeBlockers.length > 0}>{busy ? 'Starting export…' : 'Export now'}</Button></div>
  </form></Dialog>;
}
