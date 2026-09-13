import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';
import {desktopApi, type NativeBounds, type NativeSurfaceInfo} from '../services/desktop-api';
import {useEditor} from '../stores/editor-store';
import {exportPreferences} from '../services/export-preferences';
import {useMedia} from '../stores/media-store';
import type {PreviewQuality} from '../../shared/media-import';

function playbackMedia() {
  const {quality, previews} = useMedia.getState();
  const mediaKey = quality === 'high' ? '' : Object.values(previews).filter(p => p.quality === quality && p.status === 'ready').map(p => p.assetId).sort().join('|');
  return {quality, mediaKey};
}

/** Native video transport. A single in-flight request and one latest target
 * prevent a slow frame from building an unbounded seek/render queue. */
export function useNativeSurface(canvas: RefObject<HTMLDivElement | null>) {
  const [info, setInfo] = useState<NativeSurfaceInfo>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const active = useRef(false); const generation = useRef(0);
  const pendingFrame = useRef<{projectId: string; revision: number; frame: number; seekId: number; quality: PreviewQuality; mediaKey: string} | undefined>(undefined);
  const rendering = useRef(false); const stopped = useRef(false);
  const updateFrame = useCallback(async (): Promise<void> => {
    const state = useEditor.getState(); if(!active.current || stopped.current || !state.snapshot) return;
    pendingFrame.current = {projectId: state.snapshot.project.id, revision: state.snapshot.project.revision, frame: state.frame, seekId: state.seekRequest.id, ...playbackMedia()};
    if(rendering.current) return;
    rendering.current = true; const current = generation.current;
    try {
      while(pendingFrame.current && active.current && current === generation.current) {
        const target = pendingFrame.current; pendingFrame.current = undefined;
        try {
          await desktopApi.frame(target.projectId, target.revision, target.frame, target.quality, target.mediaKey);
          if(current === generation.current) setError('');
        } catch(e) {
          const next = pendingFrame.current as typeof target | undefined;
          // A seek/edit can supersede a request while its scene is preparing.
          // Its failure must not discard the newer target or stop that preview.
          if(next && (next.projectId !== target.projectId || next.revision !== target.revision || next.seekId !== target.seekId || next.quality !== target.quality || next.mediaKey !== target.mediaKey)) continue;
          throw e;
        }
      }
    } catch(e) {
      if(current === generation.current) {stopped.current = true; pendingFrame.current = undefined; setError(String((e as Error).message ?? e)); useEditor.setState({playing: false});}
    } finally {
      rendering.current = false;
      // A close/reopen may replace the generation while an old frame finishes.
      if(active.current && pendingFrame.current && !stopped.current) queueMicrotask(() => void updateFrame());
    }
  }, []);
  const retry = useCallback(() => {
    if(!active.current) return;
    stopped.current = false; setError('');
    void updateFrame();
  }, [updateFrame]);
  const bounds = useCallback((): NativeBounds => {
    const rect = canvas.current!.getBoundingClientRect();
    return {x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height, pixelRatio: window.devicePixelRatio};
  }, [canvas]);
  const close = useCallback(async () => {
    generation.current++; active.current = false;
    useEditor.setState({playing: false});
    pendingFrame.current = undefined; stopped.current = false;
    try {await desktopApi.closeSurface();} catch(e) {setError(String((e as Error).message ?? e));}
    setInfo(undefined); setBusy(false);
  }, []);
  const open = useCallback(async (vendor: 'amd'|'nvidia') => {
    if(!canvas.current || active.current) return;
    const current = ++generation.current; stopped.current = false; setBusy(true); setError(''); useEditor.setState({playing: false});
    try {
      const result = await desktopApi.openSurface(bounds(), vendor);
      if(current !== generation.current) {await desktopApi.closeSurface(); return;}
      active.current = true; setInfo(result); await updateFrame();
      const project = useEditor.getState().snapshot?.project;
      if(project && !stopped.current && current === generation.current) exportPreferences.save(project.id, {renderer: 'native-vulkan', encoder: vendor});
    } catch(e) {if(current === generation.current) setError(String((e as Error).message ?? e));}
    finally {if(current === generation.current) setBusy(false);}
  }, [canvas, bounds, updateFrame]);
  useEffect(() => {
    if(!info || !canvas.current) return;
    let timer: ReturnType<typeof setTimeout>; let chain = Promise.resolve();
    const resize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {chain = chain.then(async () => {
        if(active.current) {await desktopApi.resizeSurface(bounds()); await updateFrame();}
      }).catch(e => {setError(String(e)); void close();});}, 120);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas.current);
    const escape = (event: KeyboardEvent) => {if(event.key === 'Escape') void close();};
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', resize); window.addEventListener('scroll', resize, true);
    // Native child surfaces sit above web content. Close before dialogs cover
    // the monitor. The compatible editor remains available for canvas handles.
    const dialogs = new MutationObserver(() => {if(document.querySelector('[role="dialog"], dialog[open]')) void close();});
    dialogs.observe(document.body, {childList: true, subtree: true});
    return () => {clearTimeout(timer); observer.disconnect(); dialogs.disconnect(); window.removeEventListener('keydown', escape); window.removeEventListener('resize', resize); window.removeEventListener('scroll', resize, true);};
  }, [info, canvas, bounds, close, updateFrame]);
  useEffect(() => () => {generation.current++; if(active.current) {active.current = false; void desktopApi.closeSurface().catch(() => undefined);}}, []);
  useEffect(() => useEditor.subscribe((state, previous) => {
    if(!active.current) return;
    if(state.snapshot?.project.id !== previous.snapshot?.project.id) {useEditor.setState({playing: false}); void close(); return;}
    if(stopped.current && state.seekRequest.id !== previous.seekRequest.id) {retry(); return;}
    if(stopped.current && state.playing) {useEditor.setState({playing: false}); return;}
    if(state.frame !== previous.frame || state.snapshot?.project.revision !== previous.snapshot?.project.revision) void updateFrame();
  }), [close, updateFrame, retry]);
  useEffect(() => {
    let previous = JSON.stringify(playbackMedia());
    return useMedia.subscribe(() => {
      const next = JSON.stringify(playbackMedia());
      if(next !== previous) {previous = next; if(active.current) retry();}
    });
  }, [retry]);
  return {available: desktopApi.available(), info, error, busy, open, close, retry};
}
