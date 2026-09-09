import {Clapperboard, Keyboard, MonitorPlay, PanelLeft, PanelRight, RotateCcw, Sparkles} from 'lucide-react';
import {useState} from 'react';
import {useWorkspace, type WorkspacePreset} from '../../stores/workspace-store';
import {useEditor} from '../../stores/editor-store';
import {IconButton} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';

const presets = [{id: 'edit', label: 'Edit', icon: Clapperboard}, {id: 'review', label: 'Review', icon: MonitorPlay}, {id: 'ai', label: 'AI edit', icon: Sparkles}] as const;
const shortcuts = [['Playback', [['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['Shift + ← / →', 'Seek one second']]], ['Timeline', [['V', 'Select and move'], ['C', 'Razor tool'], ['S', 'Split at playhead'], ['N', 'Toggle snapping'], ['Ctrl / ⌘ + C', 'Copy selected clip'], ['Ctrl / ⌘ + V', 'Paste at playhead'], ['Ctrl / ⌘ + D', 'Duplicate after clip'], ['Delete', 'Remove selected clip'], ['Alt + drag', 'Temporarily ignore snapping'], ['Ctrl + right-edge drag', 'Change video speed and duration']]], ['History', [['Ctrl / ⌘ + Z', 'Undo'], ['Ctrl + Y / Ctrl + Shift + Z', 'Redo']]]] as const;

export function WorkspaceToolbar() {
  const workspace = useWorkspace(); const [help, setHelp] = useState(false);
  const choose = (preset: WorkspacePreset) => {workspace.applyPreset(preset); if(preset === 'ai') useEditor.setState({inspectorTab: 'codex'}); else if(preset === 'edit') useEditor.setState({inspectorTab: 'properties'});};
  return <div className="workspace-toolbar">
    <div className="workspace-toolbar__presets" role="group" aria-label="Workspace layout">{presets.map(({id, label, icon: Icon}) => <button key={id} aria-pressed={workspace.preset === id} onClick={() => choose(id)}><Icon size={14}/>{label}</button>)}</div>
    <span className="workspace-toolbar__hint">{workspace.preset === 'review' ? 'Review the sequence' : workspace.preset === 'ai' ? 'Edit with your connected Codex agent' : 'Drag panel borders to adjust your workspace'}</span>
    <div className="workspace-toolbar__panels">
      <IconButton label="Toggle media panel" aria-pressed={workspace.showLibrary} onClick={() => workspace.configure({showLibrary: !workspace.showLibrary})}><PanelLeft size={16}/></IconButton>
      <IconButton label="Toggle properties and Codex panel" aria-pressed={workspace.showInspector} onClick={() => workspace.configure({showInspector: !workspace.showInspector})}><PanelRight size={16}/></IconButton>
      <IconButton label="Reset workspace layout" onClick={() => choose('edit')}><RotateCcw size={14}/></IconButton>
      <IconButton label="Keyboard shortcuts" onClick={() => setHelp(true)}><Keyboard size={16}/></IconButton>
    </div>
    {help && <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}><div className="shortcut-guide">{shortcuts.map(([title, items]) => <section key={title}><h3>{title}</h3><dl>{items.map(([key, description]) => <div key={key}><dt>{description}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></section>)}<p>Click the timeline to use editing shortcuts. Text fields keep their normal keyboard behavior.</p></div></Dialog>}
  </div>;
}
