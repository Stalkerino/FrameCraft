import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import sharp from 'sharp';
import type {Project} from '../../shared/project';

test('edits markers and media folders through UI and MCP with undo and reload persistence', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const initial = await project(); const asset = initial.assets[0];
  await page.goto('/'); await page.getByRole('button', {name: 'Markers', exact: true}).click();
  await page.getByRole('button', {name: 'Add marker at playhead'}).click();
  await page.getByLabel('Marker name', {exact: true}).fill('Review opening');
  await page.getByLabel('Range marker', {exact: true}).check();
  await page.getByLabel('Marker notes').fill('Check comparison timing');
  await page.getByRole('button', {name: 'Save marker'}).click();
  await expect.poll(async () => (await project()).markers?.[0]?.name).toBe('Review opening');
  await page.getByRole('button', {name: 'Close timeline markers'}).click();
  await expect(page.getByRole('button', {name: 'Go to marker Review opening'})).toBeVisible();
  await page.getByRole('button', {name: 'Folders', exact: true}).click();
  await page.getByLabel('Folder name').fill('Rushes'); await page.getByRole('button', {name: 'Create folder', exact: true}).click();
  await expect.poll(async () => (await project()).folders?.length).toBe(1);
  const folder = (await project()).folders![0];
  await page.getByRole('button', {name: 'Close media folders'}).click();
  await page.getByLabel(`Folder for ${asset.name}`, {exact: true}).selectOption(folder.id);
  await expect.poll(async () => (await project()).assets[0].folderId).toBe(folder.id);
  await page.getByLabel('Filter media folder').selectOption(folder.id);
  await expect(page.locator('.media-card')).toHaveCount(1);
  const image = await sharp({create: {width: 8, height: 8, channels: 4, background: '#203040'}}).png().toBuffer();
  await page.getByLabel('Import media files').setInputFiles({name: 'folder-import.png', mimeType: 'image/png', buffer: image});
  await expect.poll(async () => (await project()).assets.find(a => a.name === 'folder-import.png')?.folderId).toBe(folder.id);
  await expect(page.locator('.media-card')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel(`Folder for ${asset.name}`, {exact: true})).toHaveValue(folder.id);
  const client = new Client({name: 'organization-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  try {
    const result = await client.callTool({name: 'organize_project', arguments: {revision: (await project()).revision, label: 'Organize through MCP', commands: [{type: 'marker.set', marker: {id: 'later', name: 'Later review', frame: 120}}, {type: 'folder.remove', id: folder.id}]}});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    await expect.poll(async () => (await project()).folders?.length).toBe(0);
    expect((await project()).assets[0].folderId).toBe(null);
    await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)'}).click();
    await expect.poll(async () => (await project()).folders?.length).toBe(1);
    await page.locator('.timeline').focus(); await page.keyboard.press('m');
    await expect.poll(async () => (await project()).markers?.length).toBe(2);
    expect((await project()).clips).toEqual(initial.clips);
  } finally {await client.close();}
});
