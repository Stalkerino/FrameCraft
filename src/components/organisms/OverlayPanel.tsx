import {ArrowRight, Circle, Focus, Square, ZoomIn} from 'lucide-react';
import {clipSchema} from '../../../shared/project';
import {useEditor} from '../../stores/editor-store';
import {createId} from '../../services/id-service';
import {Button} from '../atoms/Button';
import {projectTracks} from '../../../shared/tracks';
export function OverlayPanel() {
  const selectedId = useEditor(s => s.selectedId); const project = useEditor(s => s.snapshot?.project);
  const selected = project?.clips.find(c => c.id === selectedId);
  const add = (shape: 'arrow' | 'circle' | 'box') => {
    const target = project && projectTracks(project).find(t => t.id === useEditor.getState().selectedTrackId && t.type === 'text');
    const state = useEditor.getState(); const clip = clipSchema.parse({id: createId(), name: `${shape[0].toUpperCase() + shape.slice(1)} annotation`, kind: 'annotation', track: 'text', trackId: target?.id, start: state.frame, duration: Math.round((project?.fps ?? 30) * 3), x: 50, y: 50, color: '#c5f277', annotation: {shape, width: 25, height: 25, rotation: shape === 'arrow' ? -25 : 0, stroke: 8}});
    void state.execute([{type: 'clip.add', clip}], `Added ${shape} annotation`).then(ok => {if(ok) useEditor.setState({selectedId: clip.id, inspectorTab: 'properties'});});
  };
  return <div className="assist-section"><div className="assist-hint"><Focus size={24}/><strong>Callout shapes</strong><p>Add a callout at the playhead, then adjust its size, color and position in Properties.</p></div><div className="annotation-presets">{([{shape: 'arrow', label: 'Arrow', icon: ArrowRight}, {shape: 'box', label: 'Frame', icon: Square}, {shape: 'circle', label: 'Circle', icon: Circle}] as const).map(({shape, label, icon: Icon}) => <button key={shape} onClick={() => add(shape)}><Icon size={28}/><span>{label}</span></button>)}</div><div className="assist-divider"/><strong>Animated focus</strong><p className="field-help">Select a video or image clip. The zoom moves smoothly toward a point you set in Properties.</p><Button icon={<ZoomIn size={16}/>} disabled={selected?.track !== 'visual'} onClick={() => {if(selected) {void useEditor.getState().updateClip(selected.id, {zoom: {from: 1, to: 1.6, x: 50, y: 50, start: 0, end: Math.min(Math.round((project?.fps ?? 30) * 1.5), selected.duration)}, motionOffset: 0}, 'Added an animated focus zoom'); useEditor.setState({inspectorTab: 'properties'});}}}>Add focus zoom</Button><p className="field-help">Codex can place these overlays and zooms through the same editing tools, then inspect rendered frames.</p></div>;
}
