import {useEffect, useRef} from 'react';
import type {Asset} from '../../../shared/project';
import {MediaPreviewStatus} from './MediaPreviewStatus';
import {useMediaPlaybackSources} from '../../hooks/useMediaPlaybackSources';
import {playbackSourceLabel} from '../../services/preview-quality';
import {PlaybackQualitySelect} from './PlaybackQualitySelect';
import {SourceEditControls} from './SourceEditControls';
export function SourcePreview({asset, start = 0, end, seekKey = ''}: {asset: Asset; start?: number; end?: number; seekKey?: string}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const {selections, sources, pendingPreviews, onSourceError} = useMediaPlaybackSources([asset]);
  useEffect(() => {if(ref.current) {ref.current.currentTime = start; ref.current.pause();}}, [asset.id, start, seekKey]);
  const props = {ref, src: sources[asset.id] || asset.src, controls: true, preload: 'metadata', onError: () => {if(sources[asset.id] === asset.src && [3, 4].includes(ref.current?.error?.code ?? 0)) onSourceError(asset.id);}, onLoadedMetadata: () => {if(ref.current) ref.current.currentTime = start;}, onTimeUpdate: () => {if(ref.current && end !== undefined && ref.current.currentTime >= end && !ref.current.paused) {ref.current.pause(); ref.current.currentTime = start;}}};
  return <div className="source-preview">{pendingPreviews.includes(asset.id) ? <>{asset.thumbnail && <img src={asset.thumbnail} alt={asset.name}/>}<MediaPreviewStatus asset={asset}/></> : asset.kind === 'image' ? <img src={asset.src} alt={asset.name}/> : asset.kind === 'audio' ? <audio {...props}/> : <video {...props}/>}<span>Source · {asset.name} · {playbackSourceLabel(selections[0])}</span>{asset.kind === 'video' && <PlaybackQualitySelect className="source-preview__quality"/>}{(asset.kind === 'video' || asset.kind === 'audio') && <SourceEditControls key={asset.id} asset={asset} media={ref}/>}</div>;
}
