import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {clipSchema, type Project} from '../../shared/project';

test('grades footage and opacity through MCP/UI with matching browser and native export pixels', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const p = await project();
  await request.post('/api/commands', {data: {revision: p.revision, commands: [{type: 'project.clear'}, {type: 'project.color-grade', grade: null}, {type: 'project.settings', settings: {width: 320, height: 180, fps: 30, backgroundColor: '#202020'}}]}});
  const directory = path.resolve('.cache/e2e-grade-input'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'gray-source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x505050:s=320x180:r=30:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '1', '-an', '-y', source]);
  const client = new Client({name: 'grading-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async (name: string, args: Record<string, unknown>) => {const result = await client.callTool({name, arguments: args}, undefined, {timeout: 120000}); expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.content as {type: string; text?: string; data?: string}[];};
  try {
    await call('import_media', {filePath: source});
    const imported = await project(); const asset = imported.assets.find(asset => asset.name === path.basename(source))!;
    await call('edit_project', {revision: imported.revision, label: 'Grading demo', commands: [{type: 'clips.replace', clips: [
      clipSchema.parse({id: 'footage', name: 'Graded footage', kind: 'video', assetId: asset.id, track: 'visual', start: 0, duration: 30}),
      clipSchema.parse({id: 'label', name: 'Grading label', kind: 'text', track: 'text', start: 0, duration: 30, text: 'COLOR', x: 8, y: 12, align: 'left', animation: 'none', fontSize: 32}),
    ]}]});
    const revision = (await project()).revision;
    await call('set_color_grade', {revision, scope: 'clips', clipIds: ['footage'], grade: {exposure: .8, temperature: .7}, apply: false});
    expect((await project()).revision).toBe(revision);
    await call('set_color_grade', {revision, scope: 'clips', clipIds: ['footage'], grade: {exposure: .8, temperature: .7}, apply: true});
    await call('set_color_grade', {revision: (await project()).revision, scope: 'timeline', grade: {contrast: 1.1}, apply: true});
    await call('edit_project', {revision: (await project()).revision, label: 'Blend footage with background', commands: [{type: 'clip.update', id: 'footage', patch: {opacity: .5}}]});
    await page.goto('/'); await page.locator('[data-clip-id="footage"]').click();
    await page.locator('.property-section > summary').filter({hasText: 'Color grading'}).click();
    await expect(page.getByRole('spinbutton', {name: 'Exposure', exact: true})).toHaveValue('0.8');
    await expect(page.getByRole('spinbutton', {name: 'Opacity', exact: true})).toHaveValue('50');
    await page.locator('[data-clip-id="label"]').click();
    const opacity = page.getByRole('spinbutton', {name: 'Opacity', exact: true}); await opacity.fill('50'); await opacity.press('Enter');
    await expect.poll(async () => (await project()).clips.find(clip => clip.id === 'label')?.opacity).toBe(.5);
    const stillResult = await call('render_frame', {frame: 0});
    const still = Buffer.from(stillResult.find(item => item.type === 'image')!.data!, 'base64');
    const rendered = JSON.parse((await call('export_video', {revision: (await project()).revision, settings: {width: 320, height: 180, fps: 30, audio: false}})).find(item => item.type === 'text')!.text!);
    let job: {status: string; error?: string; url?: string} = {status: 'queued'};
    await expect.poll(async () => {job = await (await request.get(`/api/render/${rendered.id}`)).json(); return job.status;}, {timeout: 120000}).toMatch(/done|error/);
    expect(job.status, job.error).toBe('done');
    const output = path.join(directory, 'graded-export.mp4'); await writeFile(output, await (await request.get(job.url!)).body());
    const frame = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1']);
    const pixel = async (buffer: Buffer) => [...await sharp(buffer).extract({left: 280, top: 150, width: 1, height: 1}).removeAlpha().raw().toBuffer()];
    const browserPixel = await pixel(still); const exportPixel = await pixel(frame);
    expect(browserPixel[0]).toBeGreaterThan(browserPixel[2] + 10);
    for(let channel = 0; channel < 3; channel++) expect(Math.abs(browserPixel[channel] - exportPixel[channel])).toBeLessThanOrEqual(6);
    // The label remains neutral white blended at 50%, even under the project grade.
    const text = await sharp(still).extract({left: 25, top: 25, width: 120, height: 30}).removeAlpha().raw().toBuffer();
    const brightest = Math.max(...text); expect(brightest).toBeGreaterThan(150); expect(brightest).toBeLessThan(220);
  } finally {await client.close();}
});
