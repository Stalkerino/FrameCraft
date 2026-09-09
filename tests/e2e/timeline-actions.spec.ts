import {test, expect} from '@playwright/test';
import {clipSchema, type Snapshot} from '../../shared/project';
import {trackSchema} from '../../shared/tracks';

test('click focuses clips for copy/paste/duplicate, with undo/redo and clearing just one track', async ({page, request}) => {
  const snapshot = async (): Promise<Snapshot> => (await request.get('/api/project')).json();
  const original = await snapshot();
  const clips = [
    clipSchema.parse({id: 'copy-source', name: 'Copy source', kind: 'text', track: 'text', start: 0, duration: 60, text: 'COPY ME', animation: 'none', x: 30}),
    clipSchema.parse({id: 'keep', name: 'Keep this title', kind: 'text', track: 'text', start: 90, duration: 90, text: 'KEEP ME', animation: 'none'}),
  ];
  const setup = await request.post('/api/commands', {data: {revision: original.project.revision, commands: [
    {type: 'clips.replace', clips},
    {type: 'track.add', track: trackSchema.parse({id: 'paste-track', name: 'Text 2', type: 'text'})},
  ]}});
  expect(setup.ok()).toBe(true);
  await page.goto('/');
  const clip = page.locator('[data-clip-id="copy-source"]');
  await clip.click();
  await page.getByRole('textbox', {name: 'Text content'}).focus();
  await clip.click();
  await expect(clip).toBeFocused();
  await page.keyboard.press('Control+c');
  const waitForTimeline = async (count: number) => {
    // The server commits before the browser has applied the response and cleared busy.
    // Subsequent shortcuts must wait for the same enabled UI a user would interact with.
    await expect(page.locator('.timeline [data-clip-id]')).toHaveCount(count);
    await expect(page.getByRole('button', {name: 'Paste clip at playhead (Ctrl+V)', exact: true})).toBeEnabled();
  };
  await page.getByRole('button', {name: 'Select Text 2 track', exact: true}).click();
  await page.locator('.ruler-area').click({position: {x: 3 * 48, y: 10}});
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(3);
  const pasted = (await snapshot()).project.clips.find(c => c.trackId === 'paste-track')!;
  expect(pasted).toMatchObject({start: 90, duration: 60, text: 'COPY ME', x: 30});
  await waitForTimeline(3);
  await expect(page.locator(`[data-clip-id="${pasted.id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(4);
  const duplicated = (await snapshot()).project.clips.find(c => c.trackId === 'paste-track' && c.id !== pasted.id)!;
  expect(duplicated.start).toBe(150);
  await waitForTimeline(4);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(3);
  await waitForTimeline(3);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(4);
  await waitForTimeline(4);
  await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click();
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(3);
  await waitForTimeline(3);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(4);
  await waitForTimeline(4);
  const beforeClear = await snapshot();
  await page.getByRole('button', {name: 'Clear Text 2 track', exact: true}).click();
  await page.getByRole('dialog', {name: 'Clear Text 2?'}).getByRole('button', {name: 'Clear track', exact: true}).click();
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(2);
  await waitForTimeline(2);
  expect((await snapshot()).project.assets).toEqual(beforeClear.project.assets);
  expect((await snapshot()).project.tracks).toEqual(beforeClear.project.tracks);
  expect((await snapshot()).project.clips.map(c => c.id)).toEqual(['copy-source', 'keep']);
  await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click();
  await expect.poll(async () => (await snapshot()).project.clips).toEqual(beforeClear.project.clips);
  await waitForTimeline(4);
  await page.getByRole('button', {name: 'Redo timeline edit (Ctrl+Y / Ctrl+Shift+Z)', exact: true}).click();
  await expect.poll(async () => (await snapshot()).project.clips.length).toBe(2);
  await waitForTimeline(2);
});
