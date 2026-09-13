import {activeSequenceName} from '../../../shared/project-sequences';
import {useState} from 'react';
import {canvasSettingsSchema} from '../../../shared/media-settings';
import type {Command, Project} from '../../../shared/project';
import type {ColorGrade} from '../../../shared/color-grading';
import {useEditor} from '../../stores/editor-store';
import {Dialog} from '../atoms/Dialog';
import {Field} from '../atoms/Field';
import {Button} from '../atoms/Button';
import {ResolutionFields} from '../molecules/ResolutionFields';
import {SourceMatchControl} from '../molecules/SourceMatchControl';
import {SettingsSection} from '../molecules/SettingsSection';
import {ColorGradeFields} from '../molecules/ColorGradeFields';

export function ProjectSettingsDialog({project, onClose}: {project: Project; onClose: () => void}) {
  const [original] = useState(project);
  const [settings, setSettings] = useState(() => canvasSettingsSchema.parse(project));
  const [grade, setGrade] = useState<ColorGrade | null>(project.colorGrade ?? null);
  const [gradeChanged, setGradeChanged] = useState(false);
  const [error, setError] = useState('');
  const busy = useEditor(s => s.busy);
  return <Dialog title="Project settings" onClose={onClose}><form className="settings-form" onSubmit={event => {
    event.preventDefault(); const parsed = canvasSettingsSchema.safeParse(settings);
    if(!parsed.success) {setError(parsed.error.issues[0].message); return;}
    const commands: Command[] = [{type: 'project.settings', settings: parsed.data}];
    if(gradeChanged) commands.push({type: 'project.color-grade', grade});
    void useEditor.getState().execute(commands, 'Changed project settings', original.revision).then(ok => {if(ok) onClose();});
  }}>
    <SettingsSection title="Canvas & timing" description={`Editing sequence: ${activeSequenceName(project)}. Other sequences keep their settings.`}>
      <SourceMatchControl project={original} value={settings} showProject={false} onChange={patch => setSettings({...settings, ...patch})}/>
      <ResolutionFields value={settings} onChange={patch => setSettings({...settings, ...patch})}/>
    </SettingsSection>
    <SettingsSection title="Background & audio">
      <div className="settings-grid"><Field label="Canvas background"><input aria-label="Canvas background" type="color" value={settings.backgroundColor} onChange={event => setSettings({...settings, backgroundColor: event.target.value})}/></Field><Field label="Master volume (%)"><input aria-label="Master volume (%)" type="number" min={0} max={100} value={Math.round(settings.masterVolume * 100)} onChange={event => setSettings({...settings, masterVolume: Number(event.target.value) / 100})}/></Field></div>
    </SettingsSection>
    <SettingsSection title="Video color grade" description="Apply a shared look to every video and image after its clip adjustments. Titles, graphics and the canvas background keep their own colors.">
      <ColorGradeFields value={grade} disabled={busy} onChange={value => {setGrade(value); setGradeChanged(true);}}/>
    </SettingsSection>
    <p className="field-help">Changing frame rate preserves edit timing to the nearest frame. Resizing scales text and strokes proportionally. This change can be undone; saved export settings remain separate.</p>
    {error && <p role="alert" className="agent-inline-error">{error}</p>}
    <div className="settings-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>Apply project settings</Button></div>
  </form></Dialog>;
}
