import {useEffect, useState} from 'react';
import {desktopApi} from '../services/desktop-api';

export function useDesktopWindowState() {
  const [state, setState] = useState({maximized: false, fullscreen: false});
  useEffect(() => {
    if(!desktopApi.available()) return;
    let alive = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void desktopApi.windowState().then(value => {if(alive && request === current) setState(value);}).catch(() => {});
    };
    refresh();
    window.addEventListener('resize', refresh);
    return () => {alive = false; window.removeEventListener('resize', refresh);};
  }, []);
  return state;
}
