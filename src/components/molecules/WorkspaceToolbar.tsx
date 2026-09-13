import {Clapperboard, Keyboard, PanelLeft, PanelRight, RotateCcw} from 'lucide-react';
import {useState} from 'react';
import {useWorkspace} from '../../stores/workspace-store';
import {useEditor} from '../../stores/editor-store';
import {IconButton} from '../atoms/Button';
import {Dialog} from '../atoms/Dialog';

const shortcuts = [['Playback', [['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['Shift + ← / →', 'Seek one second']]], ['Timeline', [['V', 'Select and move'], ['C', 'Razor tool'], ['S', 'Split at playhead'], ['N', 'Toggle snapping'], ['M', 'Add timeline marker'], ['Shift + M', 'Next marker'], ['Ctrl / ⌘ + Shift + M', 'Previous marker'], ['Ctrl / ⌘ + C', 'Copy selected clip'], ['Ctrl / ⌘ + V', 'Paste at playhead'], ['Ctrl / ⌘ + D', 'Duplicate after clip'], ['Delete', 'Remove selected clip'], ['Shift + Delete', 'Ripple delete across all tracks'], ['Ctrl / ⌘ + G', 'Group selected clips'], ['Ctrl / ⌘ + Shift + G', 'Ungroup selected clips'], ['Alt + drag', 'Temporarily ignore snapping'], ['Ctrl + right-edge drag', 'Change video speed and duration']]], ['History', [['Ctrl / ⌘ + Z', 'Undo'], ['Ctrl + Y / Ctrl + Shift + Z', 'Redo']]]] as const;

export function WorkspaceToolbar() {
  const workspace = useWorkspace(); const [help, setHelp] = useState(false);
  const edit = () => {workspace.resetLayout(); useEditor.setState({inspectorTab: 'properties'});};
  return <div className="workspace-toolbar">
    <div className="workspace-toolbar__presets" role="group" aria-label="Workspace layout"><button aria-pressed={workspace.preset === 'edit'} onClick={edit}><Clapperboard size={14}/>Edit</button></div>
    <span className="workspace-toolbar__hint">Drag panel borders to adjust your workspace</span>
    <div className="workspace-toolbar__panels">
      <IconButton label="Toggle media panel" aria-pressed={workspace.showLibrary} onClick={() => workspace.configure({showLibrary: !workspace.showLibrary})}><PanelLeft size={16}/></IconButton>
      <IconButton label="Toggle properties and Codex panel" aria-pressed={workspace.showInspector} onClick={() => workspace.configure({showInspector: !workspace.showInspector})}><PanelRight size={16}/></IconButton>
      <IconButton label="Reset workspace layout" onClick={edit}><RotateCcw size={14}/></IconButton>
      <IconButton label="Keyboard shortcuts" onClick={() => setHelp(true)}><Keyboard size={16}/></IconButton>
    </div>
    {help && <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}><div className="shortcut-guide">{shortcuts.map(([title, items]) => <section key={title}><h3>{title}</h3><dl>{items.map(([key, description]) => <div key={key}><dt>{description}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></section>)}<p>Click the timeline to use editing shortcuts. Text fields keep their normal keyboard behavior.</p></div></Dialog>}
  </div>;
}
