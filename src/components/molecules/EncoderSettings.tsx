import {Cpu, MonitorPlay} from 'lucide-react';
import type {ExportSettings} from '../../../shared/media-settings';
import {useEncoderCapabilities} from '../../hooks/useEncoderCapabilities';
import {Field} from '../atoms/Field';
import {selectExportEncoder, selectExportRenderer} from '../../../shared/export-pipeline';

export function EncoderSettings({settings, onChange}: {settings: ExportSettings; onChange: (value: Partial<ExportSettings>) => void}) {
  const native = settings.renderer !== 'compatible';
  const vulkan = settings.renderer === 'native-vulkan';
  const {capabilities, error} = useEncoderCapabilities(settings.codec, settings.renderer);
  const encoders = capabilities?.encoders ?? [];
  const selected = encoders.find(encoder => encoder.id === settings.encoder);
  const automatic = encoders.find(encoder => encoder.id === 'nvidia' && encoder.available) || encoders.find(encoder => encoder.available);
  const active = settings.encoder === 'auto' ? automatic : selected?.available ? selected : undefined;
  const supportsEffort = !vulkan && (active ? /_(nvenc|amf)$/.test(active.encoder || '') : settings.encoder === 'cpu' || settings.encoder === 'auto' ? ['h264', 'h264-mkv'].includes(settings.codec) : false);
  const label = settings.encoder === 'cpu' ? 'CPU encoding selected' : !capabilities ? error || 'Reading installed encoders…' : active
    ? settings.encoder === 'auto' ? 'GPU encoders listed · checked at export' : `${active.label} listed · not tested`
    : settings.encoder === 'auto' ? 'CPU fallback · no GPU encoder candidate found' : `${selected?.label || 'Selected GPU'} unavailable`;
  return <div className="encoder-settings"><Field label="Render engine"><select aria-label="Render engine" value={settings.renderer} onChange={event => {
    const renderer = event.target.value as ExportSettings['renderer'];
    onChange(selectExportRenderer(settings, renderer));
  }}><option value="native-vulkan">Native GPU · video decode, effects, composition & encode</option><option value="compatible">Compatibility · browser composition (uses CPU)</option><option value="native-gpu">Native GPU · cuts & scaling only</option></select></Field>
    {native && <p className="field-help">{vulkan ? 'Videos, images, saved assets, vector text, animated transforms, standard/custom transitions and color grading on GPU. Includes rotation, masks with soft edges, typewriter titles, text-box crops and timed captions. Static images are prepared once on CPU, then reused as GPU textures. Requires Vulkan Video support, separate from VA-API, AMF and NVENC.' : 'GPU video decoding, scaling and encoding required. Full-canvas SDR cuts only for this increment.'} Unsupported effects stop native export; no browser fallback is used.</p>}
    <Field label="Video encoder"><select aria-label="Video encoder" value={settings.encoder} onChange={event => onChange(selectExportEncoder(settings, event.target.value as ExportSettings['encoder']))}>
    {!native && <option value="auto">Compatibility · automatic encoding (CPU fallback)</option>}<option value="amd">{vulkan ? 'AMD GPU · Vulkan Video' : native ? 'AMD GPU · VA-API / AMF' : 'AMD GPU'}</option><option value="nvidia">{vulkan ? 'NVIDIA GPU · Vulkan Video' : native ? 'NVIDIA GPU · NVENC' : 'NVIDIA GPU'}</option>{!native && <option value="cpu">CPU · software encoding</option>}
  </select></Field><div className="encoder-settings__status" role="status">{active ? <MonitorPlay size={16}/> : <Cpu size={16}/>}<span>{label}</span></div>
    {settings.encoder !== 'cpu' && <p className="field-help">{selected && !selected.available ? selected.reason : native ? 'This list does not test your GPU. The native engine requires a complete decoder, scaler and encoder path; it never falls back to CPU or browser rendering.' : 'This list does not test your GPU. Compatibility is checked when you export. Automatic allows CPU fallback; selecting AMD or NVIDIA requires that GPU.'}</p>}
    {supportsEffort && <Field label="Encoding effort"><select aria-label="Encoding effort" value={settings.preset} onChange={event => onChange({preset: event.target.value as ExportSettings['preset']})}><option value="ultrafast">Fastest</option><option value="veryfast">Very fast</option><option value="fast">Fast</option><option value="medium">Balanced</option><option value="slow">Thorough</option><option value="veryslow">Most thorough</option></select></Field>}
    {supportsEffort && <p className="field-help">More effort improves compression efficiency and takes longer to encode.</p>}
    <p className="field-help">Quality uses CRF on CPU and CQ/QP on GPU; equal numbers may produce different file sizes. Target bitrate is available for both.</p>
    {!native && <p className="field-help" role="status">Browser composition is selected. A GPU encoder alone does not make this a native GPU export. Select Native GPU above for GPU video decoding, effects, composition and encoding.</p>}
  </div>;
}
