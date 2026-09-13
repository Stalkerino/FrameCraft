import {describe, expect, it} from 'vitest';
import {assetSchema} from '../shared/project';
import {playbackSource} from '../src/services/preview-quality';

describe('preview quality source selection', () => {
  it('keeps a supported original playable while its background proxy is being prepared', () => {
    const asset = assetSchema.parse({id: 'rush', name: 'Rush', kind: 'video', src: '/media/rush.mp4', duration: 20, width: 3840, height: 2160, videoCodec: 'h264'});
    expect(playbackSource(asset, 'performance', {}, {})).toMatchObject({src: asset.src, mode: 'performance', status: 'idle', fallback: true});
    expect(playbackSource(asset, 'performance', {}, {rush: true})).toMatchObject({src: undefined});
  });
  it('plays supported originals without waiting for or using a proxy', () => {
    const asset = assetSchema.parse({id: 'native', name: 'Gameplay', kind: 'video', src: '/media/gameplay.mp4', duration: 20, width: 3840, height: 2160, videoCodec: 'h264'});
    expect(playbackSource(asset, 'high', {}, {})).toMatchObject({src: asset.src, mode: 'original', width: 3840, height: 2160, status: 'ready'});
  });
  it('keeps a legacy low-resolution proxy separate from full-resolution compatibility media', () => {
    const asset = assetSchema.parse({id: 'footage', name: 'Gameplay', kind: 'video', src: '/media/gameplay.mkv', previewSrc: '/media/gameplay-preview.mp4', duration: 20, width: 2560, height: 1440, videoCodec: 'hevc'});
    const previews = {footage: {assetId: asset.id, src: asset.previewSrc, status: 'ready' as const, progress: 1, width: 1280, height: 720}};
    expect(playbackSource(asset, 'high', previews, {})).toMatchObject({src: undefined, mode: 'high', status: 'idle'});
    expect(playbackSource(asset, 'performance', previews, {})).toMatchObject({src: asset.previewSrc, mode: 'performance', width: 1280, height: 720});
    const complete = {...previews, 'footage:high': {assetId: asset.id, src: '/media/gameplay-preview-full-v1.mp4', status: 'ready' as const, progress: 1, width: 2560, height: 1440}};
    expect(playbackSource(asset, 'high', complete, {})).toMatchObject({src: complete['footage:high'].src, width: 2560, height: 1440});
  });
  it('falls back to compatibility media after an actual original decoder error', () => {
    const asset = assetSchema.parse({id: 'native', name: 'Gameplay', kind: 'video', src: '/media/gameplay.mp4', duration: 20, videoCodec: 'h264'});
    expect(playbackSource(asset, 'high', {}, {[asset.id]: true})).toMatchObject({mode: 'high', status: 'idle', src: undefined});
  });
});
