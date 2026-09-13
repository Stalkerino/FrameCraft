import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, realpath, readdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {mediaPreviewKey} from '../../shared/media-import';

test('imports into project storage, keeps a long timeline on screen, and prepares incompatible footage in the background', async ({page, request}) => {
  const snapshot = async () => (await (await request.get('/api/project')).json());
  const initial = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'Import regression', revision: initial.project.revision, settings: {width: 640, height: 360, fps: 60}}}); expect(created.ok()).toBe(true);
  const directory = path.resolve('test-results/media-import'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'long rush.mp4');
  // Ten minutes in a tiny fixture reproduces the layout overflow without encoding a large rush.
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=1:d=600', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], {stdio: 'ignore'});
  const bytes = await readFile(source); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/'); await page.getByLabel('Import media files').setInputFiles(source);
    const card = page.getByRole('button', {name: 'Add long rush.mp4 to timeline', exact: true}); await expect(card).toBeVisible();
    const asset = (await snapshot()).project.assets[0];
    expect(asset.src).toMatch(/^\/project-media\/[a-f0-9]{64}\/media\/.+\.mp4$/); expect(asset.previewSrc).toBeUndefined();
    const stored = await request.get(asset.src); expect(stored.status()).toBe(200); expect((await stored.body()).equals(bytes)).toBe(true);
    const range = await request.get(asset.src, {headers: {Range: 'bytes=0-31'}}); expect(range.status()).toBe(206); expect((await range.body()).length).toBe(32);
    await unlink(source); // Deleting the external test fixture cannot break the imported project.
    await card.click(); await expect(page.locator('.timeline-count')).toHaveText('1 clips');
    await expect.poll(() => page.locator('.preview__canvas').evaluate(e => {const r = e.getBoundingClientRect(); return r.width > 100 && r.left >= 0 && r.right <= innerWidth;})).toBe(true);
    expect(await page.locator('.timeline-scroll').evaluate(e => e.scrollWidth > e.clientWidth * 5)).toBe(true);
    expect(await page.locator('.inspector').evaluate(e => e.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('.preview video').evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThanOrEqual(2);
    const pixel = await page.locator('.preview video').evaluate((video: HTMLVideoElement) => {const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data];});
    expect(pixel[2]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(10);
    await page.getByRole('button', {name: 'Play', exact: true}).click(); await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeVisible();
    await expect.poll(() => page.locator('.preview video').evaluate((e: HTMLVideoElement) => e.currentTime)).toBeGreaterThan(.1);
    await page.getByRole('button', {name: 'Pause', exact: true}).click();

    const incompatible = path.join(directory, 'old recording.avi');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-c:v', 'mpeg4', '-q:v', '5', incompatible], {stdio: 'ignore'});
    const imported = await request.post('/api/import-path', {data: {filePath: incompatible}}); expect(imported.ok()).toBe(true);
    const other = (await imported.json()).project.assets[1]; expect(other.previewSrc).toContain('/project-media/'); expect((await readFile(incompatible)).equals(await (await request.get(other.src)).body())).toBe(true);
    const cancelled = await request.post(`/api/media/${other.id}/preview`, {data: {action: 'cancel', quality: 'high'}}); expect((await cancelled.json()).status).toBe('cancelled');
    const pendingCard = page.getByRole('button', {name: 'Add old recording.avi to timeline', exact: true}); await expect(pendingCard).toBeVisible();
    const retryPreview = page.locator('.media-item').filter({has: pendingCard}).getByRole('button', {name: 'Retry preview for old recording.avi', exact: true});
    await page.getByRole('button', {name: 'Go to beginning', exact: true}).click(); await pendingCard.click();
    await expect(retryPreview).toBeVisible();
    await expect.poll(async () => (await snapshot()).project.clips.some((clip: {assetId: string}) => clip.assetId === other.id)).toBe(true);
    // Put the new clip at the playhead so the pending source never crashes the Remotion player.
    const current = (await snapshot()).project; const clip = current.clips.find((c: {assetId: string}) => c.assetId === other.id);
    const edited = await request.post('/api/commands', {data: {revision: current.revision, commands: [{type: 'clips.replace', clips: [{...clip, start: 0}]}], label: 'Inspect pending preview'}}); expect(edited.ok()).toBe(true);
    await expect(page.getByText('Preparing playback media.', {exact: false})).toBeVisible();
    const beforePreview = await snapshot();
    await retryPreview.click();
    await expect.poll(async () => (await (await request.get('/api/media/previews')).json())[mediaPreviewKey(other.id, 'high')]?.status, {timeout: 60000}).toBe('ready');
    await expect(page.locator('.preview video')).toBeVisible();
    await expect.poll(() => page.locator('.preview video').evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThanOrEqual(2);
    expect((await snapshot()).project.revision).toBe(beforePreview.project.revision);
    const render = await request.post('/api/render', {data: {kind: 'frame', frame: 60}}); const job = await render.json(); expect(render.ok()).toBe(true);
    await expect.poll(async () => (await (await request.get(`/api/render/${job.id}`)).json()).status, {timeout: 60000}).toMatch(/done|error/);
    const rendered = await (await request.get(`/api/render/${job.id}`)).json(); expect(rendered.status, rendered.error).toBe('done');
    const exportResponse = await request.post('/api/render', {data: {kind: 'video', settings: {width: 320, height: 180, fps: 30, startSeconds: 0, endSeconds: .5}}});
    expect(exportResponse.ok()).toBe(true); const exported = await exportResponse.json();
    await expect.poll(async () => (await (await request.get(`/api/render/${exported.id}`)).json()).status, {timeout: 60000}).toMatch(/done|error/);
    const finished = await (await request.get(`/api/render/${exported.id}`)).json(); expect(finished.status, finished.error).toBe('done');
    expect(finished.outputPath).toMatch(/[\\/]projects[\\/][a-f0-9]{64}[\\/]exported[\\/].+\.mp4$/);
    expect((await (await request.get(`/api/render/${exported.id}/output`)).json()).path).toBe(await realpath(finished.outputPath));
    expect((await request.get(finished.url)).ok()).toBe(true);
    const status = await (await request.get('/api/status')).json();
    await expect.poll(() => readdir(path.join(path.dirname(status.projectPath), 'render-cache'))).toEqual([]);
    await page.reload(); await expect(page.locator('.preview video')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {await request.post('/api/projects', {data: {action: 'open', id: initial.project.id, revision: (await snapshot()).project.revision}});}
});
