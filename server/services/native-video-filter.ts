import type {VideoSegment} from '../../shared/layered-render-plan';
import type {ExportSettings} from '../../shared/media-settings';

/** Native static geometry avoids decoding the same footage independently in
 * browser workers. Pixel rounding is bounded to one output pixel; use 4:4:4
 * before cropping so chroma subsampling cannot round away odd crop offsets.
 */
export function nativeVideoFilter(segment: VideoSegment, settings: ExportSettings, colorFilter?: string): string {
  const placement = segment.placement;
  const background = (segment.backgroundColor ?? '#080c0e').replace('#', '0x');
  if(placement === null) return `scale=${settings.width}:${settings.height},drawbox=color=${background}:t=fill`;
  if(!placement) return [`scale=${settings.width}:${settings.height}:flags=lanczos`, colorFilter].filter(Boolean).join(',');
  const {source: s, destination: d} = placement;
  const x = Math.min(settings.width - 1, Math.max(0, Math.round(d.x))); const y = Math.min(settings.height - 1, Math.max(0, Math.round(d.y)));
  const width = Math.max(1, Math.min(settings.width - x, Math.round(d.width)));
  const height = Math.max(1, Math.min(settings.height - y, Math.round(d.height)));
  const sx = Math.min(segment.asset!.width! - 1, Math.max(0, Math.round(s.x))); const sy = Math.min(segment.asset!.height! - 1, Math.max(0, Math.round(s.y)));
  const sw = Math.max(1, Math.min(segment.asset!.width! - sx, Math.round(s.width)));
  const sh = Math.max(1, Math.min(segment.asset!.height! - sy, Math.round(s.height)));
  const crop = sx || sy || sw !== segment.asset!.width || sh !== segment.asset!.height;
  const pad = x || y || width !== settings.width || height !== settings.height;
  return [crop ? `format=yuv444p,crop=${sw}:${sh}:${sx}:${sy}:exact=1` : '',
    `scale=${width}:${height}:flags=lanczos`, colorFilter,
    pad ? `format=yuv444p,pad=${settings.width}:${settings.height}:${x}:${y}:color=${background}` : ''].filter(Boolean).join(',');
}
