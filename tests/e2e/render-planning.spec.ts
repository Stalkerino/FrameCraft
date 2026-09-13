import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import type {RenderPlan} from '../../shared/render-plan';

test('explains processing through the export dialog and real MCP without editing or rendering', async ({page, request}) => {
  const before = await (await request.get('/api/project')).json();
  const client = new Client({name: 'render-plan-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')],
    env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  try {
    const inventory = await client.callTool({name: 'get_export_encoders', arguments: {codec: 'h264'}});
    expect(inventory.isError).not.toBe(true);
    expect(JSON.parse((inventory.content as {text: string}[])[0].text).verification).toBe('not-run');
    const response = await client.callTool({name: 'get_render_plan', arguments: {revision: before.project.revision}});
    expect(response.isError).not.toBe(true);
    const plan: RenderPlan = JSON.parse((response.content as {text: string}[])[0].text);
    expect(plan).toMatchObject({revision: before.project.revision, engine: 'remotion-compatibility', verification: 'not-run'});
    expect(plan.stages.map(stage => stage.id)).toEqual(['decode', 'processing', 'artwork', 'transfer', 'encode', 'audio']);
    await page.goto('/');
    await page.getByRole('button', {name: 'Export video', exact: true}).click();
    const selectLayout = await page.getByLabel('Render engine', {exact: true}).evaluate(element => {
      const style = getComputedStyle(element);
      return {available: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        fontSize: parseFloat(style.fontSize), appearance: style.appearance};
    });
    expect(selectLayout.available).toBeGreaterThanOrEqual(selectLayout.fontSize);
    expect(selectLayout.appearance).toBe('none');
    await page.locator('.render-plan > summary').click();
    await expect(page.getByText('Planned processing · hardware not tested', {exact: true})).toBeVisible();
    await expect(page.locator('.render-plan dt')).toHaveCount(6);
    // The ordinary GPU selector must select the native composition pipeline,
    // not leave GPU encoding attached to browser composition.
    await page.getByLabel('Video encoder', {exact: true}).selectOption('amd');
    await expect(page.getByLabel('Render engine', {exact: true})).toHaveValue('native-vulkan');
    await expect(page.getByRole('button', {name: 'Export now', exact: true})).toBeDisabled();
    await page.getByLabel('Render engine', {exact: true}).selectOption('native-gpu');
    await expect(page.getByRole('button', {name: 'Export now', exact: true})).toBeDisabled();
    await expect(page.getByText('Native GPU export is blocked by', {exact: true})).toBeVisible();
    const native = await client.callTool({name: 'get_render_plan', arguments: {revision: before.project.revision,
      settings: {renderer: 'native-gpu', encoder: 'amd', width: before.project.width, height: before.project.height, fps: before.project.fps}}});
    expect(native.isError).not.toBe(true);
    expect(JSON.parse((native.content as {text: string}[])[0].text)).toMatchObject({engine: 'native-gpu', route: 'unsupported', verification: 'not-run'});
    await page.getByLabel('Render engine', {exact: true}).selectOption('native-vulkan');
    await expect(page.getByRole('button', {name: 'Export now', exact: true})).toBeDisabled();
    const vulkan = await client.callTool({name: 'get_render_plan', arguments: {revision: before.project.revision,
      settings: {renderer: 'native-vulkan', encoder: 'amd', width: before.project.width, height: before.project.height, fps: before.project.fps}}});
    expect(vulkan.isError).not.toBe(true);
    expect(JSON.parse((vulkan.content as {text: string}[])[0].text)).toMatchObject({engine: 'native-vulkan', route: 'unsupported', verification: 'not-run'});
    const vkInventory = await client.callTool({name: 'get_export_encoders', arguments: {codec: 'h264', renderer: 'native-vulkan'}});
    expect(vkInventory.isError).not.toBe(true);
    expect(JSON.parse((vkInventory.content as {text: string}[])[0].text).encoders.every((item: {available: boolean}) => !item.available)).toBe(true);
    await page.getByLabel('Render engine', {exact: true}).selectOption('compatible');
    await expect(page.getByRole('button', {name: 'Export now', exact: true})).toBeEnabled();
    const stale = await request.post('/api/render/plan', {data: {revision: before.project.revision + 1}});
    expect(stale.status()).toBe(409);
    expect((await (await request.get('/api/project')).json()).project).toEqual(before.project);
  } finally {await client.close();}
});
