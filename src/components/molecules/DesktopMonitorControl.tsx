import {useState} from 'react';
import type {useNativeSurface} from '../../hooks/useNativeSurface';

export function DesktopMonitorControl({surface}: {surface: ReturnType<typeof useNativeSurface>}) {
  const [vendor, setVendor] = useState<'amd'|'nvidia'>('amd');
  if(!surface.available) return null;
  return <details className="desktop-monitor"><summary>Desktop · native monitor</summary><div className="desktop-monitor__panel">
    <p>Native Vulkan preview uses original media and the export engine’s effects. Choose the compatible preview for canvas selection handles and guides.</p>
    <label>GPU <select value={vendor} disabled={surface.busy || !!surface.info} onChange={event => setVendor(event.target.value as typeof vendor)}><option value="amd">AMD</option><option value="nvidia">NVIDIA</option></select></label>
    <button type="button" disabled={surface.busy} onClick={() => surface.info ? void surface.close() : void surface.open(vendor)}>{surface.busy ? 'Opening…' : surface.info ? 'Use compatible preview' : 'Use native GPU preview'}</button>
    {surface.info && <p role="status">{surface.info.backend} · {surface.info.adapter} · GPU decode → effects → display</p>}
    {surface.error && <p role="alert">Native preview stopped. {surface.error}</p>}
  </div></details>;
}
