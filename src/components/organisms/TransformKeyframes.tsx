import {Maximize2} from 'lucide-react';
import {useState} from 'react';
import type {Clip, Project} from '../../../shared/project';
import {visualProperties} from '../../../shared/visual-editing';
import {useAnimationEditor} from '../../hooks/useAnimationEditor';
import {animationPropertyNames} from '../../services/animation-curve-service';
import {Button} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';
import {Field} from '../atoms/Field';
import {PropertySection} from '../atoms/PropertySection';
import {AnimationCurveEditor} from '../molecules/AnimationCurveEditor';
import {AnimationKeyControls} from '../molecules/AnimationKeyControls';

export function TransformKeyframes({clip, project}: {clip: Clip; project: Project}) {
  const [expanded, setExpanded] = useState(false); const editor = useAnimationEditor(clip, project);
  const content = <div className={`animation-editor ${expanded ? 'animation-editor--expanded' : ''}`} data-animation-editor tabIndex={0} onKeyDown={editor.onKeyDown}>
    <div className="animation-editor__heading"><Field label="Animated property"><select aria-label="Animated property" value={editor.property} onChange={event => editor.selectProperty(event.target.value as typeof editor.property)}>{visualProperties.map(property => <option key={property} value={property}>{animationPropertyNames[property]} · {clip.keyframes?.[property]?.length ?? 0} keys</option>)}</select></Field>
      {!expanded && <Button icon={<Maximize2 size={12}/>} onClick={() => setExpanded(true)}>Open curve editor</Button>}
    </div>
    <div className="animation-editor__workspace"><AnimationCurveEditor key={editor.property} clip={clip} fps={project.fps} editor={editor}/><AnimationKeyControls clip={clip} project={project} editor={editor}/></div>
    {editor.locked && <p className="field-help">Unlock the clip’s position to edit X/Y animation.</p>}
    {!editor.editing.inside && <p className="field-help">Place the playhead inside this clip to add or paste keys at the playhead.</p>}
    <p className="field-help">Focus the graph: Ctrl+A/C/V · Delete · arrows move keys (Shift ×10) · Ctrl+Z / Ctrl+Shift+Z. Edits save on release; Escape cancels a drag. Keys outside trimmed fragments are retained.</p>
    {editor.error && <p className="geometry-error" role="alert">{editor.error}</p>}
  </div>;
  return <PropertySection title="Transform keyframes" defaultOpen={false} summary={editor.count ? `${editor.count} keys` : 'Static'}>
    {expanded ? <Dialog title={`Animation — ${clip.name}`} className="animation-dialog" onClose={() => setExpanded(false)}>{content}</Dialog> : content}
  </PropertySection>;
}
