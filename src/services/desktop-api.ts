import {invoke, isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';

export type WindowResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];

export interface NativeBounds {x: number; y: number; width: number; height: number; pixelRatio: number}
export interface NativeSurfaceInfo {adapter: string; backend: string; width: number; height: number; videoConnected: boolean}
export const desktopApi = {
  available: isTauri,
  openRender: (jobId: string, folder = false) => invoke<void>('open_render_output', {jobId, folder}),
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  closeWindow: () => getCurrentWindow().close(),
  resizeWindow: (direction: WindowResizeDirection) => getCurrentWindow().startResizeDragging(direction),
  windowState: async () => {
    const window = getCurrentWindow();
    const [maximized, fullscreen] = await Promise.all([window.isMaximized(), window.isFullscreen()]);
    return {maximized, fullscreen};
  },
  info: () => invoke<{platform: string; surfacePrototype: boolean; nativeVideo: boolean; verification: 'not-run'}>('desktop_info'),
  openSurface: (bounds: NativeBounds, vendor: 'amd'|'nvidia', video = true) => invoke<NativeSurfaceInfo>('surface_open', {bounds, vendor, video}),
  frame: (projectId: string, revision: number, frame: number, quality: import('../../shared/media-import').PreviewQuality = 'high', mediaKey = '') => invoke<void>('surface_frame', {projectId, revision, frame, quality, mediaKey}),
  resizeSurface: (bounds: NativeBounds) => invoke<void>('surface_resize', {bounds}),
  closeSurface: () => invoke<void>('surface_close'),
};
