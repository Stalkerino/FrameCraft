import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {clipSchema, type Project} from '../../shared/project';

test('exports an editable XML through the visible button and MCP with source trims and media links', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const directory = path.resolve('.cache/e2e-timeline-export'); await mkdir(directory, {recursive: true}); const source = path.join(directory, 'source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=60:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-threads', '1', '-shortest', '-y', source]);
  const client = new Client({name: 'timeline-export-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async (name: string, args: Record<string, unknown>) => {const result = await client.callTool({name, arguments: args}); expect(result.isError, JSON.stringify(result)).not.toBe(true); return JSON.parse((result.content as {type: string; text: string}[]).find(item => item.type === 'text')!.text);};
  try {
    await call('edit_project', {revision: (await project()).revision, label: 'XML sequence', commands: [{type: 'project.clear'}, {type: 'project.settings', settings: {width: 320, height: 180, fps: 30}}]});
    await call('import_media', {filePath: source}); const imported = await project(); const asset = imported.assets.find(asset => asset.name === 'source.mp4')!;
    await call('edit_project', {revision: imported.revision, label: 'Cuts and title', commands: [{type: 'clips.replace', clips: [
      clipSchema.parse({id: 'a', name: 'Second half', kind: 'video', track: 'visual', assetId: asset.id, start: 0, duration: 15, sourceStart: 15}),
      clipSchema.parse({id: 'b', name: 'First half', kind: 'video', track: 'visual', assetId: asset.id, start: 30, duration: 15}),
      clipSchema.parse({id: 'text', name: 'Title', kind: 'text', track: 'text', text: 'Keep this title', start: 5, duration: 20}),
    ]}]});
    const revision = (await project()).revision;
    const exported = await call('export_timeline', {revision, mediaRoot: 'D:\\Framecraft & Media'});
    expect((await project()).revision).toBe(revision); expect(exported.report).toMatchObject({visualClips: 2, audioClips: 2, omittedClips: 1});
    const xmlResponse = await request.get(exported.xmlUrl); expect(xmlResponse.ok()).toBe(true); const xml = await xmlResponse.text();
    await page.goto('/');
    const parsed = await page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'application/xml');
      return {error: document.querySelector('parsererror')?.textContent, version: document.documentElement.getAttribute('version'),
        video: [...document.querySelectorAll('sequence > media > video > track > clipitem')].map(clip => ({name: clip.querySelector('name')?.textContent, start: clip.querySelector('start')?.textContent, end: clip.querySelector('end')?.textContent, in: clip.querySelector('in')?.textContent, out: clip.querySelector('out')?.textContent})),
        media: [...document.querySelectorAll('pathurl')].map(item => item.textContent), audio: document.querySelectorAll('sequence > media > audio > track > clipitem').length};
    }, xml);
    expect(parsed.error).toBeUndefined(); expect(parsed.version).toBe('5');
    expect(parsed.video).toEqual([{name: 'Second half', start: '0', end: '15', in: '30', out: '60'}, {name: 'First half', start: '30', end: '45', in: '0', out: '30'}]);
    expect(parsed.audio).toBe(4); expect(decodeURIComponent(parsed.media[0]!)).toContain('file:///D:/Framecraft & Media/');
    await page.getByRole('button', {name: 'Export timeline', exact: true}).click();
    await page.getByRole('button', {name: 'Prepare XML export'}).click();
    await expect(page.getByRole('heading', {name: 'Timeline files ready'})).toBeVisible();
    await expect(page.getByText('1 artwork clips represented by markers', {exact: false})).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('link', {name: 'Download XML', exact: true}).click();
    expect((await download).suggestedFilename()).toMatch(/\.xml$/);
    const report = await (await request.get(exported.reportUrl)).json(); expect(report.media[0].assetId).toBe(asset.id);
    expect((await (await request.get(exported.projectUrl)).json()).revision).toBe(revision);
    const stale = await request.post('/api/timeline-export', {data: {revision: revision - 1}}); expect(stale.status()).toBe(409);
  } finally {await client.close();}
});
