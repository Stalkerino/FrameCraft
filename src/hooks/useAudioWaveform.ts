import {useEffect, useState, type RefObject} from 'react';
import type {AudioWaveform} from '../../shared/audio-waveform';
import {loadWaveform} from '../services/waveform-api';
export function useAudioWaveform(assetId: string, element: RefObject<HTMLElement | null>, sourceKey: string) {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<AudioWaveform>();
  useEffect(() => {
    if(!element.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {root: element.current.closest('.timeline-scroll'), rootMargin: '200px'});
    observer.observe(element.current); return () => observer.disconnect();
  }, [element]);
  useEffect(() => {let disposed = false; setData(undefined); if(visible) void loadWaveform(assetId, sourceKey).then(value => {if(!disposed) setData(value);}).catch(() => undefined); return () => {disposed = true;};}, [assetId, visible, sourceKey]);
  return data;
}
