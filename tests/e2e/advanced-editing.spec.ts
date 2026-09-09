import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {clipSchema, type Project} from '../../shared/project';

test('MCP crop, mask and animated transforms match preview composition and export', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const directory = path.resolve('.cache/e2e-advanced-input'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'white.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '1', '-an', '-y', source]);
  const client = new Client({name: 'advanced-editing-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async (name: string, args: Record<string, unknown>) => {const result = await client.callTool({name, arguments: args}, undefined, {timeout: 120000}); expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.content as {type: string; text?: string; data?: string}[];};
  const json = (content: {type: string; text?: string}[]) => JSON.parse(content.find(item => item.type === 'text')!.text!);
  try {
    await call('edit_project', {revision: (await project()).revision, label: 'Empty test sequence', commands: [{type: 'project.clear'}, {type: 'project.settings', settings: {width: 320, height: 180, fps: 30, backgroundColor: '#800000'}}]});
    await call('import_media', {filePath: source});
    const imported = await project(); const asset = imported.assets.find(item => item.name === 'white.mp4')!;
    await call('edit_project', {revision: imported.revision, label: 'Animated masked video', commands: [{type: 'clip.add', clip: clipSchema.parse({id: 'advanced', name: 'Advanced footage', kind: 'video', track: 'visual', assetId: asset.id, start: 0, duration: 30,
      crop: {left: 25}, mask: {shape: 'ellipse', width: 75, height: 75, feather: 4}, keyframes: {opacity: [{frame: 0, value: .5}, {frame: 29, value: 1}], rotation: [{frame: 0, value: 0, easing: 'bezier', bezier: {x1: .2, y1: 0, x2: .8, y2: 1}}, {frame: 29, value: 30}]}})}]});
    const evaluated = json(await call('inspect_clip_animation', {clipId: 'advanced', frames: [0, 29]}));
    expect(evaluated.samples.map((sample: {rotation: number}) => sample.rotation)).toEqual([0, 30]);
    await page.goto('/'); await page.locator('[data-clip-id="advanced"]').click(); await page.getByRole('button', {name: 'Go to clip start'}).click();
    await expect(page.getByRole('spinbutton', {name: 'Opacity', exact: true})).toHaveValue('50');
    await page.locator('.property-section > summary').filter({hasText: /^Mask/}).click();
    await expect(page.getByRole('combobox', {name: 'Mask shape'})).toHaveValue('ellipse');
    await page.getByRole('checkbox', {name: 'Invert mask'}).click();
    await expect.poll(async () => (await project()).clips[0].mask?.inverted).toBe(true);
    await expect(page.getByRole('checkbox', {name: 'Invert mask'})).toBeChecked();
    await page.getByRole('checkbox', {name: 'Invert mask'}).click();
    await expect.poll(async () => (await project()).clips[0].mask?.inverted).toBe(false);
    const first = Buffer.from((await call('render_frame', {frame: 0})).find(item => item.type === 'image')!.data!, 'base64');
    const last = Buffer.from((await call('render_frame', {frame: 29})).find(item => item.type === 'image')!.data!, 'base64');
    const pixel = async (buffer: Buffer, left: number, top: number) => [...await sharp(buffer).extract({left, top, width: 1, height: 1}).removeAlpha().raw().toBuffer()];
    expect(await pixel(first, 10, 10)).toEqual([128, 0, 0]);
    expect((await pixel(first, 160, 90))[1]).toBeGreaterThan(120);
    expect((await pixel(first, 160, 90))[1]).toBeLessThan(135);
    expect((await pixel(last, 160, 90))[1]).toBeGreaterThan(245);
    const render = json(await call('export_video', {revision: (await project()).revision, settings: {width: 320, height: 180, fps: 30, audio: false, encoder: 'cpu', preset: 'ultrafast'}}));
    let job: {status: string; error?: string; url?: string} = {status: 'queued'};
    await expect.poll(async () => {job = await (await request.get(`/api/render/${render.id}`)).json(); return job.status;}, {timeout: 120000}).toMatch(/done|error/);
    expect(job.status, job.error).toBe('done');
    const output = path.join(directory, 'advanced.mp4'); await writeFile(output, await (await request.get(job.url!)).body());
    const encoded = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', output, '-vf', "select='eq(n,29)'", '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
    for(const [x, y] of [[10, 10], [160, 90], [80, 90]]) {
      const expected = await pixel(last, x, y); const actual = await pixel(encoded, x, y);
      expected.forEach((value, index) => expect(Math.abs(value - actual[index])).toBeLessThanOrEqual(8));
    }
  } finally {await client.close();}
});

test('Ctrl edge drag applies once on release, cancels cleanly and shares the MCP speed service', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const directory = path.resolve('.cache/e2e-advanced-input'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'speed-source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '1', '-shortest', '-y', source]);
  const client = new Client({name: 'speed-editing-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({name, arguments: args}, undefined, {timeout: 120000}); expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content as {type: string; text: string}[]).find(item => item.type === 'text')!.text);
  };
  const waitForJob = async (id: string) => {
    let job: {status: string; error?: string} = {status: 'queued'};
    await expect.poll(async () => {job = await call('get_speed_job', {id}); return job.status;}, {timeout: 30000}).toMatch(/done|error|cancelled/);
    expect(job.status, job.error).toBe('done');
  };
  try {
    await call('edit_project', {revision: (await project()).revision, label: 'Speed sequence', commands: [{type: 'project.clear'}, {type: 'project.settings', settings: {width: 320, height: 180, fps: 30}}]});
    await call('import_media', {filePath: source}); const imported = await project(); const original = imported.assets.find(asset => asset.name === 'speed-source.mp4')!;
    await call('edit_project', {revision: imported.revision, label: 'Add speed source', commands: [{type: 'clip.add', clip: clipSchema.parse({id: 'speed', name: 'Speed footage', kind: 'video', track: 'visual', assetId: original.id, start: 0, duration: 60})}]});
    await page.goto('/'); await page.locator('[data-clip-id="speed"]').click();
    const requests: {targetDurationFrames: number}[] = [];
    page.on('request', req => {if(req.url().endsWith('/api/speed/apply') && req.method() === 'POST') requests.push(req.postDataJSON());});
    const edge = page.getByRole('button', {name: 'Trim end of Speed footage'}); const bounds = (await edge.boundingBox())!;
    const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2;
    await page.keyboard.down('Control'); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 48, y, {steps: 5});
    await expect(page.locator('.clip-retime-hint')).toContainText('3.00 s'); expect(requests).toHaveLength(0);
    await page.keyboard.press('Escape'); await page.mouse.up(); await expect(page.locator('.clip-retime-hint')).toHaveCount(0); expect(requests).toHaveLength(0);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 48, y, {steps: 5}); expect(requests).toHaveLength(0);
    const response = page.waitForResponse(res => res.url().endsWith('/api/speed/apply') && res.request().method() === 'POST');
    await page.mouse.up(); await page.keyboard.up('Control'); const queued = await (await response).json();
    expect(requests).toHaveLength(1); expect(requests[0].targetDurationFrames).toBe(90); await waitForJob(queued.id);
    let current = await project(); expect(current.clips[0].duration).toBe(90); expect(current.clips[0].assetId).not.toBe(original.id);
    expect(current.assets.find(asset => asset.id === current.clips[0].assetId)?.speedProcessing?.sourceAssetId).toBe(original.id);
    await call('undo_redo', {revision: current.revision, direction: 'undo'});
    current = await project(); expect(current.clips[0].duration).toBe(60); expect(current.clips[0].assetId).toBe(original.id);
    const ramp = await call('apply_speed_ramp', {revision: current.revision, clipId: 'speed', recipe: {points: [{frame: 0, speed: 1, easing: 'linear'}, {frame: 60, speed: 2}], holds: [{frame: 30, duration: 6}], audio: 'preserve'}});
    await waitForJob(ramp.id); current = await project();
    expect(current.clips[0].duration).toBe(48);
    const reset = await call('reset_clip_speed', {revision: current.revision, clipId: 'speed'}); await waitForJob(reset.id);
    current = await project(); expect(current.clips[0].duration).toBe(60); expect(current.clips[0].assetId).toBe(original.id);
  } finally {await client.close();}
});
