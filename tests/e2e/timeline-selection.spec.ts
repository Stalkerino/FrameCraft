import {expect, test} from '@playwright/test';
import {clipSchema} from '../../shared/project';

test('marquee selects across tracks, moves, copies and deletes a group with undo', async ({page, request}) => {
  const snapshot = async () => (await (await request.get('/api/project')).json()).project;
  const initial = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'Selection test', revision: initial.revision, settings: {width: 640, height: 360, fps: 30}}});
  expect(created.ok()).toBe(true);
  const project = await snapshot();
  const response = await request.post('/api/commands', {data: {revision: project.revision, commands: [
    {type: 'track.add', track: {id: 'selection-a', name: 'Text A', type: 'text', hidden: false, muted: false}},
    {type: 'track.add', track: {id: 'selection-b', name: 'Text B', type: 'text', hidden: false, muted: false}},
    ...[0, 1].map(i => ({type: 'clip.add', clip: clipSchema.parse({id: `selection-${i}`, name: `Selection ${i}`, kind: 'text', track: 'text', trackId: i ? 'selection-b' : 'selection-a', start: 90 + i * 30, duration: 60, text: 'Test'})})),
  ]}});
  expect(response.ok()).toBe(true); await page.goto('/');
  const first = page.locator('[data-clip-id="selection-0"]'); const second = page.locator('[data-clip-id="selection-1"]');
  await second.scrollIntoViewIfNeeded();
  const a = (await first.boundingBox())!; const b = (await second.boundingBox())!;
  const x = Math.min(a.x, b.x) - 15; const y = Math.min(a.y, b.y) - 5;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(Math.max(a.x + a.width, b.x + b.width) + 10, Math.max(a.y + a.height, b.y + b.height) + 5, {steps: 8});
  await expect(page.locator('.timeline-marquee')).toBeVisible(); await page.mouse.up();
  await expect(first).toHaveAttribute('aria-pressed', 'true'); await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+g');
  await expect.poll(async () => {
    const clips = (await snapshot()).clips;
    return !!clips[0].groupId && clips[0].groupId === clips[1].groupId;
  }).toBe(true);
  await page.keyboard.down('Alt'); await page.mouse.move(a.x + 25, a.y + 12); await page.mouse.down(); await page.mouse.move(a.x + 73, a.y + 12, {steps: 5}); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect.poll(async () => (await snapshot()).clips.map((c: {start: number}) => c.start)).toEqual([120, 150]);
  await expect(page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true})).toBeEnabled(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await snapshot()).clips.map((c: {start: number}) => c.start)).toEqual([90, 120]);
  await page.keyboard.press('Control+c'); await expect(page.getByRole('button', {name: 'Paste clip at playhead (Ctrl+V)', exact: true})).toBeEnabled(); await page.keyboard.press('Control+v');
  await expect.poll(async () => (await snapshot()).clips.length).toBe(4);
  const copies = (await snapshot()).clips;
  expect(copies[2].groupId).toBe(copies[3].groupId);
  expect(copies[2].groupId).not.toBe(copies[0].groupId);
  await expect(page.getByRole('button', {name: 'Delete selected clip', exact: true})).toBeEnabled(); await page.keyboard.press('Delete'); await expect.poll(async () => (await snapshot()).clips.length).toBe(2);
  await expect(page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true})).toBeEnabled(); await page.keyboard.press('Control+z'); await expect.poll(async () => (await snapshot()).clips.length).toBe(4);
});
