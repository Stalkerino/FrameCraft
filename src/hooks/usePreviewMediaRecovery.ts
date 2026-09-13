import {useCallback, useEffect, useRef, useState} from 'react';
import {useEditor} from '../stores/editor-store';

/** A stuck decoder or interrupted request can be replaced without reloading the editor. */
export function usePreviewMediaRecovery() {
  const media = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const healthy = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearWaiting = useCallback(() => {clearTimeout(waiting.current); waiting.current = undefined;}, []);
  const ready = useCallback(() => {
    // canplay can precede the seek to a trimmed source's first frame.
    const video = media.current;
    if(video && !video.error && !video.seeking && video.readyState >= 2) {
      clearWaiting();
      healthy.current ??= setTimeout(() => {healthy.current = undefined; setFailures(0);}, 10000);
    }
  }, [clearWaiting]);
  const failed = useCallback((reason: Error) => {clearWaiting(); clearTimeout(healthy.current); healthy.current = undefined; setError(reason.message);}, [clearWaiting]);
  const replace = useCallback(() => {clearWaiting(); setError(null); setAttempt(value => value + 1);}, [clearWaiting]);
  const retry = useCallback(() => {setFailures(0); replace();}, [replace]);
  const stalled = useCallback(() => {
    if(waiting.current) return;
    clearTimeout(healthy.current); healthy.current = undefined;
    waiting.current = setTimeout(() => {
      waiting.current = undefined;
      if(document.body.classList.contains('timeline-scrubbing')) {stalled(); return;}
      const video = media.current;
      // WebKit may complete a cancelled seek without delivering every event.
      if(video && !video.error && !video.seeking && video.readyState >= 2) {ready(); return;}
      failed(new Error('The video stopped loading.'));
    }, 6000);
  }, [failed, ready]);
  useEffect(() => useEditor.subscribe((state, previous) => {
    if(state.seekRequest.id !== previous.seekRequest.id) {clearWaiting(); stalled();}
  }), [clearWaiting, stalled]);
  useEffect(() => {
    if(!error || failures >= 2) return;
    const timer = setTimeout(() => {setFailures(value => value + 1); replace();}, 500 * (failures + 1));
    return () => clearTimeout(timer);
  }, [error, failures, replace]);
  useEffect(() => {
    const video = media.current;
    return () => {
      if(!video || video.isConnected) return;
      // Removing a video from the DOM alone can leave its request/decoder alive.
      // Release the outgoing cut before accumulating more video decoders.
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [attempt, error]);
  useEffect(() => () => {clearWaiting(); clearTimeout(healthy.current);}, [clearWaiting]);
  return {media, attempt, error, retry, failed, stalled, ready, recovering: !!error && failures < 2};
}
