import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import type {Project} from '../../shared/project';

test('edits curves, selections, handles and clipboard with undo, cancellation and the same MCP contract', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const send = async (commands: unknown[]) => {
    const response = await request.post('/api/commands', {data: {revision: (await project()).revision, label: 'Animation test', commands}});
    expect(response.ok(), await response.text()).toBe(true);
  };
  const created = await request.post('/api/projects', {data: {action: 'new', revision: (await project()).revision, name: 'Animation test', settings: {width: 320, height: 180, fps: 30, backgroundColor: '#000000', masterVolume: 1}}});
  expect(created.ok()).toBe(true);
  await send([{type: 'clip.add', clip: {id: 'title', kind: 'text', track: 'text', name: 'Animated title', start: 0, duration: 120, text: 'Animated', fontSize: 30, animation: 'none', keyframes: {x: [{frame: 10, value: 20}, {frame: 40, value: 80}, {frame: 100, value: 50}]}}}]);
  await page.goto('/'); await page.locator('.timeline [data-clip-id="title"]').click();
  await page.getByText('Transform keyframes', {exact: true}).click(); await page.getByRole('button', {name: 'Open curve editor', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Animation — Animated title'}); await expect(dialog).toBeVisible();
  const graph = dialog.getByLabel('x animation curve', {exact: true});
  const frames = async () => (await project()).clips[0].keyframes!.x!.map(key => key.frame);
  await graph.getByRole('button', {name: 'Move animation key at frame 10', exact: true}).click();
  await graph.getByRole('button', {name: 'Move animation key at frame 40', exact: true}).click({modifiers: ['Shift']});
  await page.keyboard.press('ArrowRight'); await expect.poll(frames).toEqual([11, 41, 100]);
  await page.keyboard.press('Control+z'); await expect.poll(frames).toEqual([10, 40, 100]);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(frames).toEqual([11, 41, 100]);
  await dialog.getByRole('button', {name: 'Undo animation edit (Ctrl+Z)'}).click(); await expect.poll(frames).toEqual([10, 40, 100]);

  // A numeric collision must preserve every key and explain the rejection.
  await graph.getByRole('button', {name: 'Move animation key at frame 10', exact: true}).click();
  const frameField = dialog.getByLabel('Selected key frame', {exact: true});
  await frameField.fill('100'); await frameField.press('Tab');
  await expect(dialog.getByRole('alert')).toContainText('occupies'); expect(await frames()).toEqual([10, 40, 100]);
  await dialog.getByLabel('Outgoing easing', {exact: true}).selectOption('bezier');
  const handle = graph.getByRole('button', {name: 'Curve Bezier handle 1', exact: true}); const handleBox = (await handle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await page.mouse.down();
  await page.mouse.move(handleBox.x + 30, handleBox.y - 12, {steps: 3}); await page.mouse.up();
  await expect.poll(async () => (await project()).clips[0].keyframes!.x![0].bezier!.x1).not.toBe(.25);

  // Cancelling a drag inside the modal must neither save nor close it.
  const beforeCancel = (await project()).revision; const keyBox = (await graph.getByRole('button', {name: 'Move animation key at frame 10', exact: true}).boundingBox())!;
  await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height / 2); await page.mouse.down(); await page.mouse.move(keyBox.x + 18, keyBox.y - 15, {steps: 3});
  await page.keyboard.press('Escape'); await page.mouse.up(); expect((await project()).revision).toBe(beforeCancel); await expect(dialog).toBeVisible();

  // Marquee-select the first two keys, copy, then paste their spacing at frame 60.
  const bounds = (await graph.boundingBox())!;
  await page.mouse.move(bounds.x + 2, bounds.y + 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .38, bounds.y + bounds.height - 2, {steps: 4}); await page.mouse.up();
  await expect(dialog.getByText('2 selected', {exact: true})).toBeVisible();
  await page.keyboard.press('Control+c');
  await graph.click({position: {x: bounds.width * 60 / 119, y: bounds.height - 5}});
  await dialog.getByRole('button', {name: 'Paste animation keys at playhead (Ctrl+V)'}).click();
  await expect.poll(frames).toEqual([10, 40, 60, 90, 100]);
  await dialog.getByRole('button', {name: 'Delete selected animation keys', exact: true}).click(); await expect.poll(frames).toEqual([10, 40, 100]);
  await dialog.getByRole('button', {name: 'Undo animation edit (Ctrl+Z)'}).click(); await expect.poll(frames).toEqual([10, 40, 60, 90, 100]);
  await dialog.getByRole('button', {name: 'Zoom into animation curve', exact: true}).click(); await dialog.getByRole('button', {name: 'Fit clip animation', exact: true}).click();
  await dialog.getByRole('button', {name: 'Close animation — animated title', exact: true}).click();

  const client = new Client({name: 'animation-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  try {
    const changed = await client.callTool({name: 'edit_project', arguments: {revision: (await project()).revision, label: 'AI animation edit', commands: [
      {type: 'clip.animate', id: 'title', edit: {action: 'upsert', property: 'opacity', keys: [{frame: 0, value: 0}, {frame: 30, value: 1}]}},
      {type: 'clip.animate', id: 'title', edit: {action: 'ease', property: 'opacity', frames: [0], easing: 'ease-in-out'}},
    ]}}); expect(changed.isError, JSON.stringify(changed)).not.toBe(true);
    const inspection = await client.callTool({name: 'inspect_clip_animation', arguments: {clipId: 'title', frames: [0, 15, 30]}});
    const body = JSON.parse((inspection.content as {type: string; text: string}[]).find(item => item.type === 'text')!.text);
    expect(body.samples.map((sample: {opacity: number}) => Math.round(sample.opacity * 100))).toEqual([0, 50, 100]);
    const native = await request.post('/api/render/native-preview', {data: {revision: (await project()).revision, frame: 15, width: 320, height: 180, vendor: 'amd'}});
    expect(native.ok(), await native.text()).toBe(true);
    const compiled = await native.json(); expect(compiled.graph).not.toContain('hwdownload'); expect(compiled.inputs).toEqual([]);
  } finally {await client.close();}
  await page.reload(); await page.locator('.timeline [data-clip-id="title"]').click(); await page.getByText('Transform keyframes', {exact: true}).click();
  await page.getByLabel('Animated property', {exact: true}).selectOption('opacity');
  await expect(page.getByLabel('opacity animation curve', {exact: true}).getByRole('button', {name: 'Move animation key at frame 30', exact: true})).toBeVisible();
});
