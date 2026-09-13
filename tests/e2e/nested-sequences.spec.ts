import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import sharp from 'sharp';
import type {Project} from '../../shared/project';

test('edits a live nested sequence through UI/MCP, preserves group opacity and builds its native preview graph', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const send = async (commands: unknown[]) => {
    const response = await request.post('/api/commands', {data: {revision: (await project()).revision, label: 'Nested editing', commands}});
    expect(response.ok(), await response.text()).toBe(true);
  };
  const created = await request.post('/api/projects', {data: {action: 'new', revision: (await project()).revision, name: 'Nested test', settings: {width: 320, height: 180, fps: 24, backgroundColor: '#0000ff', masterVolume: 1}}});
  expect(created.ok()).toBe(true);
  await send([{type: 'clip.add', clip: {id: 'title', name: 'Title', kind: 'text', track: 'text', start: 0, duration: 24, text: 'Original', fontSize: 22, animation: 'typewriter'}},
    {type: 'sequence.create', id: 'parent', name: 'Parent', settings: {width: 320, height: 180, fps: 30, backgroundColor: '#000000', masterVolume: 1}}]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Insert sequence', exact: true}).click();
  await page.locator('.sequence-insert-menu__items button').filter({hasText: 'Main'}).click();
  await expect.poll(async () => (await project()).clips.length).toBe(1);
  const id = (await project()).clips[0].id;
  expect((await project()).clips[0]).toMatchObject({kind: 'sequence', sequenceId: 'main', duration: 30});
  await expect(page.getByRole('button', {name: 'Open source sequence', exact: true})).toBeVisible();
  await send([{type: 'clip.update', id, patch: {opacity: .5, duration: 60}}]);
  await page.getByRole('button', {name: 'Open source sequence', exact: true}).click();
  await expect(page.getByLabel('Active sequence', {exact: true})).toHaveValue('main');
  await page.locator('.timeline [data-clip-id="title"]').click();
  await page.getByLabel('Text content', {exact: true}).fill('Live edit'); await page.getByLabel('Text content', {exact: true}).press('Tab');
  await expect.poll(async () => (await project()).clips[0].text).toBe('Live edit');
  await page.getByLabel('Active sequence', {exact: true}).selectOption('parent');
  await expect(page.locator('.preview__canvas [data-nested-content]')).toBeVisible();
  await page.reload(); await expect(page.locator('.timeline [data-clip-id]')).toHaveCount(1);

  const client = new Client({name: 'nested-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  try {
    const changed = await client.callTool({name: 'edit_project', arguments: {revision: (await project()).revision, label: 'Change live child', commands: [
      {type: 'sequence.open', id: 'main'}, {type: 'project.settings', settings: {width: 320, height: 180, fps: 24, backgroundColor: '#00ff00', masterVolume: 1}}, {type: 'sequence.open', id: 'parent'},
    ]}}); expect(changed.isError, JSON.stringify(changed)).not.toBe(true);
    const snapshot = await client.callTool({name: 'get_project', arguments: {}});
    const body = JSON.parse((snapshot.content as {type: string; text: string}[]).find(item => item.type === 'text')!.text);
    expect(body.project.clips[0].sequenceId).toBe('main'); expect(body.project.sequences).toBeUndefined();
    const sampleFrame = (await project()).clips[0].start + 15;
    const response = await request.post('/api/render', {data: {kind: 'frame', frame: sampleFrame, revision: (await project()).revision}});
    expect(response.status()).toBe(202); const job = await response.json();
    let completed: {status: string; url: string; error?: string};
    await expect.poll(async () => {completed = await (await request.get(`/api/render/${job.id}`)).json(); return completed.status;}, {timeout: 90000}).toMatch(/done|error/);
    expect(completed!.status, completed!.error).toBe('done');
    const image = sharp(await (await request.get(completed!.url)).body());
    expect(await image.metadata()).toMatchObject({width: 320, height: 180});
    const pixel = await image.extract({left: 4, top: 4, width: 1, height: 1}).removeAlpha().raw().toBuffer();
    expect(pixel[0]).toBe(0); expect(pixel[1]).toBeGreaterThanOrEqual(127); expect(pixel[1]).toBeLessThanOrEqual(128); expect(pixel[2]).toBe(0);
    // Compiles the same recursive graph used by native desktop/export. Never opens GPU hardware.
    const native = await request.post('/api/render/native-preview', {data: {revision: (await project()).revision, frame: sampleFrame, width: 320, height: 180, vendor: 'amd'}});
    expect(native.ok(), await native.text()).toBe(true);
    const nativeScene = await native.json(); expect(nativeScene.inputs).toEqual([]);
    expect(nativeScene.graph).toContain('[preview_group0]format=pix_fmts=vulkan');
    expect(nativeScene.graph).not.toContain('hwdownload');
    const transfer = await request.post('/api/timeline-export', {data: {revision: (await project()).revision}});
    expect(transfer.ok(), await transfer.text()).toBe(true);
    const xml = await (await request.get((await transfer.json()).xmlUrl)).text();
    const document = await page.evaluate(value => {
      const parsed = new DOMParser().parseFromString(value, 'application/xml');
      return {errors: parsed.querySelectorAll('parsererror').length, nestedDuration: parsed.querySelector('sequence[id="sequence-2"] > duration')?.textContent};
    }, xml);
    expect(document).toEqual({errors: 0, nestedDuration: '48'});
    const remove = await client.callTool({name: 'manage_sequences', arguments: {revision: (await project()).revision, commands: [{type: 'sequence.remove', id: 'main'}]}});
    expect(remove.isError).toBe(true); expect((await project()).sequences?.some(sequence => sequence.id === 'main')).toBe(true);
    await page.locator(`.timeline [data-clip-id="${id}"]`).click();
    await page.getByRole('button', {name: 'Duplicate source for this instance'}).click();
    await expect.poll(async () => (await project()).clips[0].sequenceId).not.toBe('main');
    await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)'}).click();
    await expect.poll(async () => (await project()).clips[0].sequenceId).toBe('main');
  } finally {await client.close();}
});
