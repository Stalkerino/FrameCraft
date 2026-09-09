import {useEffect, type CSSProperties} from 'react';
import {AbsoluteFill, Html5Video, OffthreadVideo, useBufferState, useRemotionEnvironment, useVideoConfig} from 'remotion';
import {usePreviewMediaRecovery} from '../../hooks/usePreviewMediaRecovery';

interface Props {clipId: string; src: string; sourceStart: number; volume: number | ((frame: number) => number); muted: boolean; style: CSSProperties; onUnsupportedSource?: () => void}
export function TimelineVideo(props: Props) {
  const {isPlayer} = useRemotionEnvironment();
  return isPlayer ? <PreviewVideo key={props.src} {...props}/> : <OffthreadVideo data-preview-clip={props.clipId} src={props.src} trimBefore={props.sourceStart} volume={props.volume} muted={props.muted} style={props.style}/>;
}

function PreviewVideo({clipId, src, sourceStart, volume, muted, style, onUnsupportedSource}: Props) {
  const recovery = usePreviewMediaRecovery();
  const {width} = useVideoConfig();
  const buffer = useBufferState();
  useEffect(() => {
    if(!recovery.error) return;
    const handle = buffer.delayPlayback();
    return () => handle.unblock();
  }, [buffer, recovery.error]);
  if(recovery.error) return <AbsoluteFill role="status" style={{alignItems: 'center', justifyContent: 'center', gap: width / 100, background: '#080c0e', color: '#fff', fontFamily: 'Arial', fontSize: width / 60}}>
    <span>{recovery.recovering ? 'Reconnecting video…' : 'This video could not be loaded.'}</span>
    {!recovery.recovering && <button type="button" onClick={recovery.retry} style={{font: 'inherit', padding: '.4em .8em'}}>Retry video</button>}
  </AbsoluteFill>;
  return <Html5Video key={recovery.attempt} ref={recovery.media} data-preview-clip={clipId} src={src} trimBefore={sourceStart} volume={volume} muted={muted} style={style}
    pauseWhenBuffering onError={error => {if([3, 4].includes(recovery.media.current?.error?.code ?? 0)) onUnsupportedSource?.(); recovery.failed(error);}} onLoadStart={recovery.stalled} onWaiting={recovery.stalled} onStalled={recovery.stalled}
    onSeeking={recovery.stalled} onSeeked={recovery.ready} onLoadedData={recovery.ready} onCanPlay={recovery.ready} onPlaying={recovery.ready}/>;
}
