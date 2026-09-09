import type {ExportSettings} from './media-settings';

export type GpuVendor = 'amd' | 'nvidia';
export type EncodingBackend = 'vaapi' | 'amf' | 'nvenc';
export interface EncoderAvailability {
  id: GpuVendor;
  label: string;
  available: boolean;
  encoder?: string;
  reason?: string;
}
export interface EncoderCapabilities {
  codec: ExportSettings['codec'];
  encoders: EncoderAvailability[];
}
