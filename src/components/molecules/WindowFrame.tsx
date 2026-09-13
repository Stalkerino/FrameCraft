import {desktopApi, type WindowResizeDirection} from '../../services/desktop-api';
import {useDesktopWindowState} from '../../hooks/useDesktopWindowState';
import {useEditor} from '../../stores/editor-store';

const edges: WindowResizeDirection[] = ['North', 'East', 'South', 'West', 'NorthEast', 'SouthEast', 'SouthWest', 'NorthWest'];
export function WindowFrame() {
  const {maximized, fullscreen} = useDesktopWindowState();
  if(!desktopApi.available() || maximized || fullscreen) return null;
  return <div className="window-frame" aria-hidden="true">{edges.map(direction => <div key={direction}
    className={`window-frame__edge window-frame__edge--${direction}`} data-resize-direction={direction}
    onPointerDown={event => {
      if(event.button !== 0) return;
      event.preventDefault();
      void desktopApi.resizeWindow(direction).catch(error => useEditor.setState({error: `Could not resize window: ${String(error)}`}));
    }}/>)}</div>;
}
