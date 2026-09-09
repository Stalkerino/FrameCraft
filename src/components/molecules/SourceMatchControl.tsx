import {useState} from 'react';
import {Clapperboard, Monitor, Video} from 'lucide-react';
import {outputQualityNotices, sourceOutputSettings, videoSources} from '../../../shared/output-quality';
import type {Project} from '../../../shared/project';
import {Button} from '../atoms/Button';
import {Field} from '../atoms/Field';

interface Dimensions {width: number; height: number; fps: number}
export function SourceMatchControl({project, value, onChange, showProject = true}: {project: Project; value: Dimensions; onChange: (value: Dimensions) => void; showProject?: boolean}) {
  const sources = videoSources(project);
  const [sourceId, setSourceId] = useState(sources[0]?.id);
  const source = sources.find(asset => asset.id === sourceId) ?? sources[0];
  const matching = source ? sourceOutputSettings(source, value.fps) : null;
  const notices = outputQualityNotices(source, value);
  return <div className="source-match">
    {source && <div className="source-match__source"><Video size={17}/><div><strong>{source.name}</strong><span>{source.width} × {source.height}{source.fps ? ` · ${Number(source.fps.toFixed(3))} fps` : ' · original footage'}</span></div></div>}
    {sources.length > 1 && <Field label="Reference footage"><select aria-label="Reference footage" value={source?.id} onChange={event => setSourceId(event.target.value)}>{sources.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.width} × {asset.height}</option>)}</select></Field>}
    <div className="source-match__actions">{showProject && <Button type="button" icon={<Monitor size={14}/>} onClick={() => onChange({width: project.width, height: project.height, fps: project.fps})}>Match project</Button>}{matching && <Button type="button" icon={<Clapperboard size={14}/>} onClick={() => onChange(matching)}>Match source{source?.fps ? '' : ' resolution'}</Button>}</div>
    {source && !source.fps && <p className="field-help">This older import has no stored frame rate. Matching its resolution keeps {value.fps} fps.</p>}
    {notices.length > 0 && <div className="settings-notice" role="status">{notices.map(notice => <p key={notice}>{notice}</p>)}</div>}
  </div>;
}
