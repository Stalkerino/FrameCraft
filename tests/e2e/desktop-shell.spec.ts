import {test, expect} from '@playwright/test';

test('desktop header, resize edges, project menus and export opening use native actions', async ({page}) => {
  await page.addInitScript(() => {
    const calls: {command: string; args: unknown}[] = [];
    Object.assign(window, {isTauri: true, desktopCalls: calls, __TAURI_INTERNALS__: {
      metadata: {currentWindow: {label: 'main'}},
      invoke: async (command: string, args: unknown) => {calls.push({command, args}); return false;},
    }});
  });
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Minimize window', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Minimize window', exact: true}).click();
  await page.getByRole('button', {name: 'Maximize or restore window', exact: true}).click();
  await page.locator('[data-resize-direction="SouthEast"]').dispatchEvent('pointerdown', {button: 0});
  await page.getByRole('button', {name: 'Project menu', exact: true}).click();
  await page.getByRole('button', {name: 'New project', exact: false}).click();
  await expect(page.getByRole('dialog', {name: 'New project', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.getByRole('button', {name: 'Project menu', exact: true}).click();
  await page.getByRole('button', {name: 'Open project', exact: false}).click();
  await expect(page.getByRole('dialog', {name: 'Open project', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Close open project', exact: true}).click();
  const id = '00000000-0000-4000-8000-000000000001';
  // Transport fixture: no encoding or external player is launched by this UI check.
  await page.route('**/api/render', route => route.fulfill({json: {id, kind: 'video', revision: 0, status: 'done', progress: 1, url: `/exports/${id}.mp4`}}));
  await page.getByRole('button', {name: 'Export video', exact: true}).click();
  await page.getByRole('button', {name: 'Export now', exact: true}).click();
  await page.getByRole('button', {name: 'Open video', exact: true}).click();
  await page.getByRole('button', {name: 'Open export folder', exact: true}).click();
  const calls = await page.evaluate(() => (window as unknown as {desktopCalls: {command: string; args: unknown}[]}).desktopCalls);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({command: 'plugin:window|minimize'}),
    expect.objectContaining({command: 'plugin:window|toggle_maximize'}),
    expect.objectContaining({command: 'plugin:window|start_resize_dragging', args: expect.objectContaining({value: 'SouthEast'})}),
    {command: 'open_render_output', args: {jobId: id, folder: false}},
    {command: 'open_render_output', args: {jobId: id, folder: true}},
  ]));
  await page.setViewportSize({width: 960, height: 640});
  const close = await page.getByRole('button', {name: 'Close window', exact: true}).boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(960);
});
