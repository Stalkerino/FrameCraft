import {useState} from 'react';
import {activeSequenceId} from '../../../shared/project-sequences';
import {useEditor} from '../../stores/editor-store';
import {useColorScopes} from '../../hooks/useColorScopes';
import {useColorLibrary} from '../../hooks/useColorLibrary';
import {ColorGradeFields} from '../molecules/ColorGradeFields';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
import {ColorScopePlot} from '../atoms/ColorScopePlot';
export function ColorWorkspaceDialog({onClose}:{onClose:()=>void}){
  const project=useEditor(s=>s.snapshot?.project);const selectedId=useEditor(s=>s.selectedId);const busy=useEditor(s=>s.busy);const frame=useEditor(s=>s.frame);
  const [scope,setScope]=useState<'clip'|'timeline'>('timeline');const scopes=useColorScopes();const library=useColorLibrary();
  if(!project)return null;const clip=project.clips.find(clip=>clip.id===selectedId&&['video','image','sequence'].includes(clip.kind));const value=scope==='clip'?clip?.colorGrade:project.colorGrade;
  const source=project.assets.find(asset=>asset.id===clip?.assetId);const capture=scopes.capture;const stale=capture&&(capture.revision!==project.revision||capture.frame!==frame||capture.projectId!==project.id||capture.sequenceId!==activeSequenceId(project));
  return <Dialog title="Color & scopes" className="color-workspace-dialog" onClose={onClose}><div className="color-workspace">
    <div className="color-workspace__controls"><Field label="Color grading target"><select aria-label="Color grading target" value={scope} onChange={event=>setScope(event.target.value as typeof scope)}><option value="timeline">Active sequence footage</option><option value="clip" disabled={!clip}>{clip?.name??'Select a video/image clip'}</option></select></Field>
      <ColorGradeFields value={value} disabled={busy||library.busy||scope==='clip'&&!clip} onChange={grade=>void useEditor.getState().execute([scope==='timeline'?{type:'project.color-grade',grade}:{type:'clip.update',id:clip!.id,patch:{colorGrade:grade}}],'Changed color grade',project.revision)}/>
      <div className="color-workspace__library"><h3>LUT library</h3><label className="button button--secondary">Import .cube<input aria-label="Import color LUT" type="file" accept=".cube" disabled={busy||library.busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void library.importFile(file);}}/></label>
        <Field label="Saved LUTs"><select aria-label="Saved LUTs" value="" disabled={busy||library.busy} onChange={event=>{if(event.target.value)void library.attach(event.target.value);}}><option value="">Add a saved LUT to this project…</option>{library.library.filter(lut=>!project.colorLuts?.some(item=>item.id===lut.id)).map(lut=><option key={lut.id} value={lut.id}>{lut.name} · {lut.size}³</option>)}</select></Field><p className="field-help">Imported LUTs are saved in your library and embedded once in the project. Choose one above to apply it.</p>{library.error&&<p role="alert" className="geometry-error">{library.error}</p>}
      </div>
      <details><summary>Color pipeline & source</summary><p className="field-help">Working primaries: sRGB / Rec.709. Corrections run in the chosen grading space; the creative LUT receives sRGB after correction. Output: Rec.709 SDR, 8-bit. HDR mastering and automatic camera-log conversion are not enabled.</p>
      {source&&<dl className="color-source-tags">{Object.entries(source.colorMetadata??{}).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value??'Untagged'}</dd></div>)}</dl>}
      <p className="field-help">A LUT on a nested sequence group requires native GPU preview/export. Browser composition supports LUTs directly on footage. A camera conversion LUT must match the decoded input signal; Framecraft does not infer that mapping.</p></details>
    </div>
    <div className="color-workspace__scopes"><div className="color-workspace__capture"><Button disabled={scopes.busy||busy} onClick={()=>void scopes.analyze()}>{scopes.busy?'Capturing…':'Capture scopes at playhead'}</Button>{capture&&<span>{stale?'Previous capture · ':''}frame {capture.frame} · revision {capture.revision}</span>}</div>
      <p className="field-help">On-demand scopes of a sampled, composed sRGB frame. Capturing pauses playback and saves a PNG; it shares the export queue. These are display values, not HDR nits or raw camera levels.</p>
      {scopes.error&&<p role="alert" className="geometry-error">{scopes.error}</p>}
      {capture?.result?<><div className="color-scopes-grid">{(['waveform','parade','vectorscope','histogram'] as const).map(mode=><ColorScopePlot key={mode} data={capture.result!} mode={mode}/>)}</div><p className="field-help">Mean luma {capture.result.meanLuma.toFixed(1)}% · near black {capture.result.nearBlackPercent.toFixed(1)}% · near white {capture.result.nearWhitePercent.toFixed(1)}% · {capture.result.width} × {capture.result.height} sampled pixels</p></>:<div className="color-scopes-empty">Capture a frame to inspect its color distribution.</div>}
    </div>
  </div></Dialog>;
}
