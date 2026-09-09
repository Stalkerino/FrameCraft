import {useCallback, useEffect, useRef, useState} from 'react';

/** A stuck decoder or interrupted request can be replaced without reloading the editor. */
export function usePreviewMediaRecovery() {
  const media = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const waiting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearWaiting = useCallback(() => {clearTimeout(waiting.current); waiting.current = undefined;}, []);
  const ready = useCallback(() => {
    // canplay can precede the seek to a trimmed source's first frame.
    const video = media.current;
    if(video && !video.error && !video.seeking && video.readyState >= 2) clearWaiting();
  }, [clearWaiting]);
  const failed = useCallback((reason: Error) => {clearWaiting(); setError(reason.message);}, [clearWaiting]);
  const retry = useCallback(() => {clearWaiting(); setError(null); setAttempt(value => value + 1);}, [clearWaiting]);
  const stalled = useCallback(() => {
    if(waiting.current) return;
    waiting.current = setTimeout(() => failed(new Error('The video stopped loading.')), 6000);
  }, [failed]);
  useEffect(() => {
    if(!error || attempt >= 2) return;
    const timer = setTimeout(retry, 500 * (attempt + 1));
    return () => clearTimeout(timer);
  }, [error, attempt, retry]);
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
  useEffect(() => clearWaiting, [clearWaiting]);
  return {media, attempt, error, retry, failed, stalled, ready, recovering: !!error && attempt < 2};
}
