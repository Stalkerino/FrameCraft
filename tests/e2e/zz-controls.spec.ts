import {test, expect, firefox} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {clipSchema} from '../../shared/project';
import {audioCodecsFor, codecNames} from '../../shared/media-settings';

test('moves and resizes canvas elements in one undo step, cancels conflicts and changes project settings', async ({page, request}) => {
  const initial = (await (await request.get('/api/project')).json()).project; const image = initial.assets.find((a: {kind: string}) => a.kind === 'image');
  const clips = [clipSchema.parse({id: 'direct-image', name: 'Direct image', kind: 'image', assetId: image.id, track: 'visual', start: 0, duration: 90, scale: .4}), clipSchema.parse({id: 'direct-text', name: 'Direct text', kind: 'text', track: 'text', start: 0, duration: 90, animation: 'none', text: 'Drag this text', x: 25, y: 15, fontSize: 80})];
  const created = await request.post('/api/commands', {data: {revision: initial.revision, commands: [{type: 'clips.replace', clips}]}}); expect(created.ok()).toBe(true);
  await page.goto('/'); const getProject = async () => (await (await request.get('/api/project')).json()).project;
  const target = page.getByRole('button', {name: 'Move Direct text on canvas', exact: true}); await expect(target).toBeVisible();
  const canvas = (await page.locator('.preview__canvas').boundingBox())!; const box = (await target.boundingBox())!; const before = await getProject();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, {steps: 8});
  expect((await getProject()).revision).toBe(before.revision); await page.mouse.up();
  await expect.poll(async () => (await getProject()).revision).toBe(before.revision + 1);
  expect((await getProject()).clips.find((c: {id: string}) => c.id === 'direct-text').x).toBeCloseTo(25 + 40 / canvas.width * 100, 1);
  const handle = page.getByRole('button', {name: 'Resize Direct text se'}); const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down(); await page.mouse.move(corner.x + 36, corner.y + 20, {steps: 8}); await page.mouse.up();
  await expect.poll(async () => (await getProject()).clips.find((c: {id: string}) => c.id === 'direct-text').scale).toBeGreaterThan(1);
  await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click();
  await expect.poll(async () => (await getProject()).clips.find((c: {id: string}) => c.id === 'direct-text').scale).toBe(1);
  const imageTarget = page.getByRole('button', {name: 'Move Direct image on canvas', exact: true}); const imageBox = (await imageTarget.boundingBox())!;
  await page.mouse.move(imageBox.x + 10, imageBox.y + 10); await page.mouse.down(); await page.mouse.move(imageBox.x + 45, imageBox.y + 30, {steps: 4});
  const concurrent = await getProject(); await request.post('/api/commands', {data: {revision: concurrent.revision, commands: [{type: 'clip.update', id: 'direct-image', patch: {x: 65}}]}});
  await expect(page.getByRole('spinbutton', {name: 'Position X', exact: true})).toHaveValue('65'); await page.mouse.up(); expect((await getProject()).clips[0].x).toBe(65);
  await page.getByRole('button', {name: 'Project settings', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Project settings'}); await dialog.getByRole('combobox', {name: 'Resolution preset'}).selectOption('5'); await dialog.getByRole('combobox', {name: 'Frame rate preset'}).selectOption('60'); await dialog.getByRole('button', {name: 'Apply project settings'}).click();
  await expect(dialog).not.toBeVisible(); await expect.poll(async () => (await getProject()).fps).toBe(60); expect((await getProject()).clips[0].duration).toBe(180);
  await expect.poll(async () => {const vertical = (await page.locator('.preview__canvas').boundingBox())!; return vertical.width / vertical.height;}).toBeCloseTo(1080 / 1920, 2);
  await page.screenshot({path: 'test-results/canvas-controls.png'});
});

test('exports supported codecs with independent output resolution, frame rate, range and audio settings', async ({page, request}) => {
  // This spec must not depend on media imported by editor.spec or z-assist.spec.
  const directory = path.resolve('test-results/codecs'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'export-source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '1', '-shortest', '-y', source]);
  const response = await request.post('/api/import-path', {data: {filePath: source}}); expect(response.ok()).toBe(true);
  const initial = (await response.json()).project; const asset = initial.assets.at(-1);
  const commands = [{type: 'clips.replace', clips: [clipSchema.parse({id: 'export-source', name: 'Export source', assetId: asset.id, kind: 'video', track: 'visual', start: 0, sourceStart: 0, duration: Math.round(initial.fps * 2)})]}, {type: 'project.settings', settings: {width: 640, height: 360, fps: 30}}];
  expect((await request.post('/api/commands', {data: {revision: initial.revision, commands}})).ok()).toBe(true);
  const project = (await (await request.get('/api/project')).json()).project;
  await page.goto('/'); await page.getByRole('button', {name: 'Export video', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Export settings'}); await dialog.getByRole('spinbutton', {name: 'Width (px)'}).fill('320'); await dialog.getByRole('spinbutton', {name: 'Height (px)'}).fill('180'); await dialog.getByRole('combobox', {name: 'Rate control'}).selectOption('bitrate'); await dialog.getByRole('spinbutton', {name: 'Video bitrate (Mbps)'}).fill('1.5');
  await page.screenshot({path: 'test-results/export-settings.png'}); await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  for(const codec of codecNames) {
    const settings = {width: 320, height: 180, fps: codec === 'h264' ? 29.97 : 24, codec, audioCodec: audioCodecsFor(codec)[0], audio: codec !== 'h264-mkv', qualityMode: codec === 'h264' ? 'bitrate' : 'quality', videoBitrate: 1.5, proResProfile: '4444', startSeconds: .25, endSeconds: 1.25, sampleRate: 44100};
    const response = await request.post('/api/render', {data: {kind: 'video', revision: project.revision, settings}}); expect(response.ok()).toBe(true); const {id} = await response.json();
    await expect.poll(async () => (await (await request.get(`/api/render/${id}`)).json()).status, {timeout: 120000}).toMatch(/done|error/);
    const job = await (await request.get(`/api/render/${id}`)).json(); expect(job.status, job.error).toBe('done');
    const file = path.join(directory, job.filename); await writeFile(file, await (await request.get(job.url)).body());
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'})); const video = probe.streams.find((s: {codec_type: string}) => s.codec_type === 'video');
    expect([video.width, video.height]).toEqual([320, 180]); expect(video.codec_name).toBe(codec === 'h265' ? 'hevc' : codec === 'h264-mkv' ? 'h264' : codec);
    const [n, d] = video.avg_frame_rate.split('/').map(Number); expect(n / d).toBeCloseTo(settings.fps, 2); expect(Number(probe.format.duration)).toBeCloseTo(1, 0);
    expect(probe.streams.some((s: {codec_type: string}) => s.codec_type === 'audio')).toBe(settings.audio);
    expect((await (await request.get('/api/project')).json()).project.revision).toBe(project.revision);
  }
});

test('Firefox records a prompt with MediaRecorder and keeps transcription as an editable draft', async ({request}) => {
  test.skip(!existsSync(firefox.executablePath()), 'Install Playwright Firefox to exercise this browser.');
  const browser = await firefox.launch({executablePath: firefox.executablePath(), firefoxUserPrefs: {'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true}});
  try {
    await request.post('/api/agent/chat/start', {data: {fresh: true}});
    const page = await browser.newPage({viewport: {width: 1440, height: 960}}); let bytes = 0;
    // Real Firefox microphone stream/MediaRecorder; deterministic inference response for UI tests.
    await page.route('**/api/analysis/dictation', async route => {bytes = route.request().postDataBuffer()?.length ?? 0; await route.fulfill({json: {id: 'voice-ui-fixture', kind: 'dictation', status: 'done', progress: 1, message: 'Ready', text: 'Ajoute un titre au début.'}});});
    await page.goto('http://127.0.0.1:4319'); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
    await page.getByRole('combobox', {name: 'Speech recognition mode'}).selectOption('local');
    const prompt = page.getByRole('textbox', {name: 'Message Codex'}); await prompt.fill('Merci.');
    await page.getByRole('button', {name: 'Dictate a prompt'}).click(); await expect(page.getByRole('button', {name: 'Stop dictation'})).toBeVisible();
    await expect(prompt).not.toBeEditable(); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
    await page.getByRole('button', {name: 'Stop dictation'}).click(); await expect(prompt).toHaveValue('Merci. Ajoute un titre au début.'); expect(bytes).toBeGreaterThan(100);
    await expect(prompt).toBeEditable(); await expect(page.locator('.agent-message--user')).toHaveCount(0); await page.screenshot({path: 'test-results/firefox-dictation.png'});
  } finally {await browser.close();}
});
