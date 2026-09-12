import {Cpu, MonitorPlay} from 'lucide-react';
import type {ExportSettings} from '../../../shared/media-settings';
import {useEncoderCapabilities} from '../../hooks/useEncoderCapabilities';
import {Field} from '../atoms/Field';

export function EncoderSettings({settings, onChange}: {settings: ExportSettings; onChange: (value: Partial<ExportSettings>) => void}) {
  const {capabilities, error} = useEncoderCapabilities(settings.codec);
  const selected = capabilities?.encoders.find(encoder => encoder.id === settings.encoder);
  const automatic = capabilities?.encoders.find(encoder => encoder.id === 'nvidia' && encoder.available) || capabilities?.encoders.find(encoder => encoder.available);
  const active = settings.encoder === 'auto' ? automatic : selected?.available ? selected : undefined;
  const supportsEffort = active ? /_(nvenc|amf)$/.test(active.encoder || '') : settings.encoder === 'cpu' || settings.encoder === 'auto' ? ['h264', 'h264-mkv'].includes(settings.codec) : false;
  const label = settings.encoder === 'cpu' ? 'CPU encoding selected' : !capabilities ? error || 'Detecting compatible GPU encoders…' : active ? `${active.label} available` : settings.encoder === 'auto' ? 'CPU fallback · no compatible GPU encoder detected' : `${selected?.label || 'Selected GPU'} unavailable`;
  return <div className="encoder-settings"><Field label="Video encoder"><select aria-label="Video encoder" value={settings.encoder} onChange={event => onChange({encoder: event.target.value as ExportSettings['encoder']})}>
    <option value="auto">Automatic · prefer GPU</option><option value="amd">AMD GPU · VA-API / AMF</option><option value="nvidia">NVIDIA GPU · NVENC</option><option value="cpu">CPU · software encoding</option>
  </select></Field><div className="encoder-settings__status" role="status">{active ? <MonitorPlay size={16}/> : <Cpu size={16}/>}<span>{label}</span></div>
    {settings.encoder !== 'cpu' && <p className="field-help">{selected && !selected.available ? selected.reason : 'Automatic uses a compatible GPU and falls back to CPU when unavailable. Selecting AMD or NVIDIA requires that GPU. H.264, H.265 and AV1 depend on hardware support.'}</p>}
    {supportsEffort && <Field label="Encoding effort"><select aria-label="Encoding effort" value={settings.preset} onChange={event => onChange({preset: event.target.value as ExportSettings['preset']})}><option value="ultrafast">Fastest</option><option value="veryfast">Very fast</option><option value="fast">Fast</option><option value="medium">Balanced</option><option value="slow">Thorough</option><option value="veryslow">Most thorough</option></select></Field>}
    {supportsEffort && <p className="field-help">More effort improves compression efficiency and takes longer to encode.</p>}
    <p className="field-help">Quality uses CRF on CPU and CQ/QP on GPU; equal numbers may produce different file sizes. Target bitrate is available for both.</p>
    {settings.encoder !== 'cpu' && <p className="field-help">GPU encoding and effect rendering are separate capabilities. Export progress shows the active decoder and compositor. Audio and some filters use CPU; unsupported effects retain their appearance through the shared renderer.</p>}
  </div>;
}
