import {useEffect, useRef} from 'react';
import {useAudioWaveform} from '../../hooks/useAudioWaveform';

export function AudioWaveform({assetId, sourceKey, start, duration}: {assetId: string; sourceKey: string; start: number; duration: number}) {
  const ref = useRef<HTMLCanvasElement>(null); const data = useAudioWaveform(assetId, ref, sourceKey);
  useEffect(() => {
    const canvas = ref.current; if(!canvas) return;
    if(!data) {canvas.width = 1; canvas.height = 1; return;}
    const draw = () => {
      const width = Math.max(1, Math.min(4096, Math.round(canvas.getBoundingClientRect().width)));
      canvas.width = width; canvas.height = 32; const context = canvas.getContext('2d'); if(!context) return;
      context.fillStyle = '#b8ddd3';
      for(let x = 0; x < width; x++) {
        const begin = Math.max(0, Math.floor((start + duration * x / width) / data.secondsPerBin));
        const end = Math.min(data.peaks.length, Math.max(begin + 1, Math.ceil((start + duration * (x + 1) / width) / data.secondsPerBin)));
        let peak = 0; for(let i = begin; i < end; i++) peak = Math.max(peak, data.peaks[i]);
        const height = Math.max(1, peak * 30); context.fillRect(x, (32 - height) / 2, 1, height);
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [data, start, duration]);
  return <canvas className="audio-waveform" width={1} height={1} ref={ref} aria-label="Audio waveform"/>;
}
