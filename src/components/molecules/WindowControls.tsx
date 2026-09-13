import {Minus, Square, X} from 'lucide-react';
import {desktopApi} from '../../services/desktop-api';
import {useEditor} from '../../stores/editor-store';
import {IconButton} from '../atoms/Button';

export function WindowControls() {
  if(!desktopApi.available()) return null;
  const run = (action: () => Promise<void>) => {void action().catch(error => useEditor.setState({error: `Window action failed: ${String(error)}`}));};
  return <div className="window-controls" aria-label="Window controls">
    <IconButton label="Minimize window" onClick={() => run(desktopApi.minimize)}><Minus size={14}/></IconButton>
    <IconButton label="Maximize or restore window" onClick={() => run(desktopApi.toggleMaximize)}><Square size={12}/></IconButton>
    <IconButton label="Close window" className="window-controls__close" onClick={() => run(desktopApi.closeWindow)}><X size={16}/></IconButton>
  </div>;
}
