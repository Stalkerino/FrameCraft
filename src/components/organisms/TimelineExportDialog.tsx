import {Download, FileCode2, FileJson, FolderOpen} from 'lucide-react';
import {useState} from 'react';
import type {Project} from '../../../shared/project';
import {useTimelineExport} from '../../hooks/useTimelineExport';
import {Dialog} from '../atoms/Dialog';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';
export function TimelineExportDialog({project, onClose}: {project: Project; onClose: () => void}) {
  const [original] = useState(project); const [mediaRoot, setMediaRoot] = useState(''); const editing = useTimelineExport(original);
  const result = editing.result;
  return <Dialog title="Export timeline" onClose={onClose}><div className="timeline-export">
    <div className="timeline-export__intro"><FileCode2 size={26}/><div><h3>Continue editing in Premiere</h3><p>Download an editable sequence as Final Cut Pro 7 XML. Compatible editors can import its cuts and media references.</p></div></div>
    <div className="timeline-export__format"><strong>Premiere-compatible XML</strong><span>.xml · Final Cut Pro 7 / XMEML 5</span></div>
    <p className="field-help">This transfers the edit structure. It does not create a .prproj file or render a finished video. Custom titles, masks, grading and transitions need rebuilding; the report identifies affected clips.</p>
    <details className="settings-disclosure"><summary><FolderOpen size={14}/> Media location on the destination computer</summary><div>
      <Field label="Destination media folder"><input aria-label="Destination media folder" placeholder="Optional · D:\Framecraft\media or /home/me/media" disabled={editing.busy} value={mediaRoot} onChange={event => {setMediaRoot(event.target.value); editing.clear();}}/></Field>
      <p className="field-help">Leave blank to reference the current project files. For another computer, enter the folder where you will copy the media. This changes XML references only; it does not copy files.</p>
    </div></details>
    {editing.error && <p className="agent-inline-error" role="alert">{editing.error}</p>}
    {result && <section className="timeline-export__result" aria-label="Timeline export ready">
      <h3>Timeline files ready</h3><p>{result.report.visualClips} visual clips · {result.report.audioClips} clips with audio · {result.report.videoTracks} video tracks · {result.report.audioTracks} audio tracks</p>
      <div className="timeline-export__downloads"><a href={result.xmlUrl} download={result.filename}><Download size={15}/> Download XML</a><a href={result.reportUrl} download="timeline-report.json"><FileJson size={15}/> Compatibility report</a><a href={result.projectUrl} download="framecraft-project.json"><FileJson size={15}/> Full Framecraft backup</a></div>
      <ol><li>In Premiere, choose <strong>File → Import</strong> and select the XML.</li><li>If media is offline, use <strong>Link Media</strong> to locate the files listed below.</li><li>Review sequence markers and the compatibility report before finishing the edit.</li></ol>
      <details className="timeline-export__warnings" open={result.report.warnings.length > 0}><summary>{result.report.warnings.length} compatibility notes{result.report.omittedClips ? ` · ${result.report.omittedClips} artwork clips represented by markers` : ''}</summary><ul>{result.report.warnings.map((warning, index) => <li key={index}><strong>{warning.name}</strong><span>{warning.message}</span></li>)}</ul>{!result.report.warnings.length && <p>No unsupported Framecraft effects found. Destination codec support still depends on the editor.</p>}</details>
      <details className="timeline-export__media"><summary>{result.report.media.length} referenced media files</summary><p>Media is not embedded in XML. Copy these files with their listed filenames, or download them individually for relinking. No proxy files are substituted.</p><ul>{result.report.media.map(item => <li key={item.assetId}><div><strong>{item.name}</strong><code>{item.filename}</code></div><a href={item.src} download={item.filename} aria-label={`Download ${item.name}`}><Download size={14}/></a></li>)}</ul></details>
    </section>}
    <div className="settings-actions"><Button onClick={onClose}>Close</Button><Button variant="primary" icon={<FileCode2 size={15}/>} disabled={editing.busy} onClick={() => void editing.create(mediaRoot)}>{editing.busy ? 'Preparing timeline…' : result ? 'Regenerate XML' : 'Prepare XML export'}</Button></div>
  </div></Dialog>;
}
