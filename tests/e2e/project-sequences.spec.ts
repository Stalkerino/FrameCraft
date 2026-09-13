import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import sharp from 'sharp';
import type {Project} from '../../shared/project';

test('switches independent sequences through UI and MCP, persists them and exports an inactive sequence', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const initial = await project(); const originalSequenceId = initial.sequenceId ?? 'main';
  await page.goto('/');
  await page.getByRole('button', {name: 'Sequences', exact: true}).click();
  await page.getByLabel('New sequence name', {exact: true}).fill('Short version');
  await page.getByRole('button', {name: 'Duplicate current sequence', exact: true}).click();
  await expect.poll(async () => (await project()).sequenceName).toBe('Short version');
  const copyId = (await project()).sequenceId!;
  expect((await project()).clips).toEqual(initial.clips);
  await page.getByRole('button', {name: 'Sequences', exact: true}).click();
  await page.getByLabel('New sequence name', {exact: true}).fill('Vertical');
  await page.getByRole('button', {name: 'Create blank sequence', exact: true}).click();
  await expect.poll(async () => (await project()).sequenceName).toBe('Vertical');
  const blankId = (await project()).sequenceId!;
  await expect(page.locator('.timeline [data-clip-id]')).toHaveCount(0);
  expect((await project()).assets).toEqual(initial.assets);
  await page.getByLabel('Active sequence', {exact: true}).selectOption(originalSequenceId);
  await expect.poll(async () => (await project()).sequenceId).toBe(originalSequenceId);
  expect((await project()).clips).toEqual(initial.clips);
  await page.reload(); await expect(page.getByLabel('Active sequence', {exact: true})).toHaveValue(originalSequenceId);

  const client = new Client({name: 'sequences-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  try {
    const list = await client.callTool({name: 'list_sequences', arguments: {}}); expect(list.isError).not.toBe(true);
    const result = await client.callTool({name: 'edit_project', arguments: {revision: (await project()).revision, label: 'Set up vertical timeline', commands: [
      {type: 'sequence.open', id: blankId},
      {type: 'project.settings', settings: {width: 180, height: 320, fps: 24, backgroundColor: '#dd2233', masterVolume: 1}},
      {type: 'clip.add', clip: {id: 'seq-title', name: 'Vertical title', kind: 'text', track: 'text', start: 0, duration: 24, text: 'Vertical', fontSize: 20, animation: 'none'}},
    ]}});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    await expect(page.getByLabel('Active sequence', {exact: true})).toHaveValue(blankId);
    await expect(page.locator('.timeline [data-clip-id="seq-title"]')).toBeVisible();
    await expect(page.locator('.preview__canvas')).toBeVisible();
    const inspect = await client.callTool({name: 'get_sequence', arguments: {id: originalSequenceId}}); expect(inspect.isError).not.toBe(true);
    expect((await project()).sequenceId).toBe(blankId);
    const opened = await client.callTool({name: 'manage_sequences', arguments: {revision: (await project()).revision, commands: [{type: 'sequence.open', id: copyId}]}});
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    await expect(page.getByLabel('Active sequence', {exact: true})).toHaveValue(copyId);
    // A single tiny software frame verifies render routing; hardware is disabled in this isolated server.
    const response = await request.post('/api/render', {data: {kind: 'frame', frame: 12, revision: (await project()).revision, sequenceId: blankId}});
    expect(response.status()).toBe(202); const job = await response.json();
    let completed: {status: string; url: string; error?: string};
    await expect.poll(async () => {completed = await (await request.get(`/api/render/${job.id}`)).json(); return completed.status;}, {timeout: 90000}).toMatch(/done|error/);
    expect(completed!.status, completed!.error).toBe('done');
    const image = sharp(await (await request.get(completed!.url)).body());
    expect(await image.metadata()).toMatchObject({width: 180, height: 320});
    const pixel = await image.extract({left: 0, top: 0, width: 1, height: 1}).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual([221, 34, 51]);
    expect((await project()).sequenceId).toBe(copyId);
    await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)'}).click();
    await expect(page.getByLabel('Active sequence', {exact: true})).toHaveValue(blankId);
    await page.reload(); await expect(page.locator('.timeline [data-clip-id="seq-title"]')).toBeVisible();
  } finally {await client.close();}
});
