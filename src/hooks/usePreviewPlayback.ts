import {type PlayerRef} from '@remotion/player';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {durationOf} from '../../shared/project';
import {useEditor} from '../stores/editor-store';

const STALL_TIMEOUT = 8000;
const MAX_RECOVERIES = 2;

/** Owns the preview transport and replaces a stuck decoder/buffering context in place. */
export function usePreviewPlayback(identity: string, muted: boolean) {
  const player = useRef<PlayerRef>(null);
  const pendingSeek = useRef<number | null>(null);
  const attempts = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<'ready' | 'loading' | 'recovering' | 'blocked'>('ready');
  const playing = useEditor(s => s.playing);
  const seekRequest = useEditor(s => s.seekRequest);
  const playerKey = `${identity}/${generation}`;
  const retry = useCallback(() => {
    attempts.current = 0;
    setStatus('recovering');
    setGeneration(value => value + 1);
  }, []);

  useLayoutEffect(() => {attempts.current = 0; setStatus('ready');}, [identity]);
  useLayoutEffect(() => {
    const ref = player.current; if(!ref) return;
    // A replacement resumes at the observed playhead, not the last (possibly old)
    // seek request. Remounting also discards buffer handles left by a removed clip.
    const state = useEditor.getState();
    const target = Math.min(state.frame, state.snapshot ? durationOf(state.snapshot.project) - 1 : 0);
    pendingSeek.current = null;
    const update = ({detail}: {detail: {frame: number}}) => {
      if(pendingSeek.current !== null && detail.frame !== pendingSeek.current) return;
      pendingSeek.current = null;
      useEditor.setState({frame: detail.frame});
    };
    const pause = () => useEditor.setState({playing: false});
    const play = () => useEditor.setState({playing: true});
    let buffering = false;
    const waiting = () => {buffering = true;};
    const resume = () => {buffering = false;};
    ref.addEventListener('frameupdate', update);
    ref.addEventListener('pause', pause);
    ref.addEventListener('play', play);
    ref.addEventListener('ended', pause);
    ref.addEventListener('waiting', waiting);
    ref.addEventListener('resume', resume);
    if(ref.getCurrentFrame() !== target) {pendingSeek.current = target; ref.seekTo(target);}

    let lastFrame = ref.getCurrentFrame();
    let stalledSince = performance.now();
    let healthySince = performance.now();
    let recovering = false;
    const watchdog = setInterval(() => {
      const now = performance.now();
      const currentFrame = ref.getCurrentFrame();
      // Background tabs deliberately throttle playback. Do not keep reloading them.
      if(document.hidden) {stalledSince = now; healthySince = now; lastFrame = currentFrame; return;}
      const healthy = !buffering && (!useEditor.getState().playing || currentFrame !== lastFrame);
      lastFrame = currentFrame;
      if(healthy) {
        recovering = false;
        stalledSince = now;
        setStatus('ready');
        if(now - healthySince > 10000) attempts.current = 0;
        return;
      }
      healthySince = now;
      if(recovering) return;
      if(now - stalledSince < STALL_TIMEOUT) {
        if(now - stalledSince > 1000) setStatus(status => status === 'recovering' ? status : 'loading');
        return;
      }
      recovering = true;
      if(attempts.current >= MAX_RECOVERIES) {setStatus('blocked'); return;}
      attempts.current++;
      setStatus('recovering');
      setGeneration(value => value + 1);
    }, 500);
    return () => {
      clearInterval(watchdog);
      ref.removeEventListener('frameupdate', update);
      ref.removeEventListener('pause', pause);
      ref.removeEventListener('play', play);
      ref.removeEventListener('ended', pause);
      ref.removeEventListener('waiting', waiting);
      ref.removeEventListener('resume', resume);
    };
  }, [playerKey]);

  // Only explicit seeks drive the clock. Playback updates never seek the player.
  useEffect(() => {
    const ref = player.current; if(!ref) return;
    if(ref.getCurrentFrame() !== seekRequest.frame) {pendingSeek.current = seekRequest.frame; ref.seekTo(seekRequest.frame);}
    else pendingSeek.current = null;
  }, [seekRequest]);
  useEffect(() => {
    const ref = player.current; if(!ref) return;
    if(muted) ref.mute(); else ref.unmute();
    if(playing && !ref.isPlaying()) ref.play();
    else if(!playing && ref.isPlaying()) ref.pause();
  }, [playing, playerKey, muted]);

  return {player, playerKey, status, retry};
}
