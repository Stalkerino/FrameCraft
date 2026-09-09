import {useState} from 'react';
import {AudioLines, Film, Plus, Type} from 'lucide-react';
import {useEditor} from '../../stores/editor-store';
import {Button} from '../atoms/Button';
export function AddTrackMenu() {
  const [open, setOpen] = useState(false); const busy = useEditor(s => s.busy);
  return <div className="track-add"><Button icon={<Plus size={14}/>} aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>Add track</Button>{open && <div className="track-add__menu">{([{type: 'visual', label: 'video', icon: Film}, {type: 'text', label: 'text', icon: Type}, {type: 'audio', label: 'audio', icon: AudioLines}] as const).map(({type, label, icon: Icon}) => <button key={type} onClick={() => {setOpen(false); void useEditor.getState().addTrack(type);}}><Icon size={14}/>Add {label} track</button>)}</div>}</div>;
}
