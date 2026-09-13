import {afterEach, expect, it, vi} from 'vitest';
import {createDemo} from '../shared/demo';
import {clipSchema} from '../shared/project';
import {NativePreviewService} from '../server/services/native-preview-service';
import type {MediaPreview} from '../shared/media-import';
const service = new NativePreviewService();
afterEach(() => vi.unstubAllEnvs());
const project = () => ({...createDemo(), assets: [{id: 'rush', name: 'Rush', kind: 'video' as const, src: '/media/original.mp4', previewSrc: '/media/proxy.mp4', duration: 20, width: 1920, height: 1080}],
  clips: [clipSchema.parse({id: 'a', name: 'Opening', kind: 'video', track: 'visual', assetId: 'rush', start: 0, sourceStart: 30, duration: 90, transition: 'none', opacity: .7}),
    clipSchema.parse({id: 'b', name: 'Next cut', kind: 'video', track: 'visual', assetId: 'rush', start: 90, sourceStart: 300, duration: 60, transition: 'none'})]});
it('plans from the requested frame using original media and ends at the next cut without initializing a GPU', async () => {
  vi.stubEnv('FRAMECRAFT_DISABLE_GPU', '1'); const p = project();
  const first = await service.scene(p, {revision: p.revision, frame: 45, width: 640, height: 360, vendor: 'amd'});
  expect(first.start).toBe(45); expect(first.duration).toBe(45);
  expect(first.inputs[0].file).toMatch(/original\.mp4$/); expect(first.inputs[0].sourceStart).toBe(2.5);
  expect(first.graph).toContain('format=rgba:fps=30'); expect(first.graph).toContain('custom_shader_bin=');
  expect(first.graph).not.toMatch(/hwdownload|_vulkan.*encoder|proxy\.mp4/);
  const second = await service.scene(p, {revision: p.revision, frame: 90, width: 640, height: 360, vendor: 'nvidia'});
  expect(second.inputs[0].sourceStart).toBe(10); expect(second.duration).toBe(60);
});
it('rejects stale revisions and unsupported scenes explicitly', async () => {
  const p = project(); const request = {revision: p.revision, frame: 0, width: 640, height: 360, vendor: 'amd'};
  await expect(service.scene(p, {...request, revision: p.revision + 1})).rejects.toMatchObject({status: 409});
  await expect(service.scene(p, {...request, frame: 999})).rejects.toThrow('outside the timeline');
  const image = {...p, assets: [{id: 'svg', name: 'Vector', kind: 'image' as const, src: '/media/vector.svg', width: 640, height: 360, duration: 20}], clips: [clipSchema.parse({id: 'svg', name: 'Vector', kind: 'image', assetId: 'svg', track: 'visual', start: 0, duration: 90})]};
  await expect(service.scene(image, request)).rejects.toThrow(/SVG|image formats/);
});
it('uses ready editing proxies without changing source timing, framing or project data', async () => {
  const p = project(); const before = JSON.stringify(p);
  const proxy: MediaPreview = {assetId: 'rush', quality: 'proxy-360', src: '/media/editing-proxy.mp4', width: 640, height: 360, status: 'ready', progress: 1};
  const proxies = {snapshot: vi.fn(() => ({'rush:proxy-360': proxy}))};
  const preview = new NativePreviewService(proxies);
  const request = {revision: p.revision, frame: 45, width: 640, height: 360, vendor: 'amd', quality: 'proxy-360', mediaKey: 'rush'};
  const result = await preview.scene(p, request);
  expect(result.inputs[0]).toMatchObject({file: expect.stringMatching(/editing-proxy\.mp4$/), width: 640, height: 360, sourceStart: 2.5});
  expect(result).toMatchObject({quality: 'proxy-360', mediaKey: 'rush'});
  expect(result.graph).toContain('crop_w=');
  expect(JSON.stringify(p)).toBe(before);
  const original = await preview.scene(p, {...request, quality: 'high'});
  expect(original.inputs[0]).toMatchObject({file: expect.stringMatching(/original\.mp4$/), width: 1920, height: 1080, sourceStart: 2.5});
  proxy.status = 'running';
  const preparing = await preview.scene(p, request);
  expect(preparing.inputs[0].file).toMatch(/original\.mp4$/);
  preview.close();
});
