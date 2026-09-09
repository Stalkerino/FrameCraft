import {useEffect, useMemo} from 'react';
import type {Asset} from '../../shared/project';
import {changeMediaPreview, rejectOriginalPlayback, useMedia} from '../stores/media-store';
import {playbackSource, type PlaybackSource} from '../services/preview-quality';

/** Playback media is browser-local state, independent of project edits and export. */
export function useMediaPlaybackSources(assets: Asset[]) {
  // Progress ticks do not change this signature or Remotion's inputProps. Only
  // changing a source or its availability should affect the playback clock.
  const signature = useMedia(state => JSON.stringify(assets.map(asset => playbackSource(asset, state.quality, state.previews, state.unsupportedOriginals))));
  const selections = useMemo<PlaybackSource[]>(() => JSON.parse(signature), [signature]);
  useEffect(() => {
    for(const source of selections) if(source.mode !== 'original' && source.status === 'idle') void changeMediaPreview(source.assetId, 'ensure', source.mode);
  }, [selections]);
  const sources = useMemo(() => Object.fromEntries(selections.filter(source => source.src).map(source => [source.assetId, source.src!])), [selections]);
  const originalIds = useMemo(() => selections.filter(source => source.mode === 'original').map(source => source.assetId), [selections]);
  const pendingPreviews = useMemo(() => selections.filter(source => !source.src).map(source => source.assetId), [selections]);
  return {sources, originalIds, pendingPreviews, selections, onSourceError: rejectOriginalPlayback};
}
