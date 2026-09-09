import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

test('cuts by clicking, splits repeatedly at the playhead, trims, deletes and undoes', async ({page, request}) => {
  const snapshot = async () => (await (await request.get('/api/project')).json()); const original = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'Manual cuts', revision: original.project.revision, settings: {width: 640, height: 360, fps: 60}}}); expect(created.ok()).toBe(true);
  const directory = path.resolve('test-results/manual-cuts'); await mkdir(directory, {recursive: true}); const source = path.join(directory, 'rush.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], {stdio: 'ignore'});
  const imported = await request.post('/api/import-path', {data: {filePath: source}}); expect(imported.ok()).toBe(true);
  const intervals = async () => (await snapshot()).project.clips.map((c: {start: number; duration: number; sourceStart: number}) => [c.start, c.duration, c.sourceStart]);
  try {
    await page.goto('/'); await page.getByRole('button', {name: 'Add rush.mp4 to timeline', exact: true}).click(); await expect(page.locator('.timeline-count')).toHaveText('1 clips');
    await page.getByRole('button', {name: 'Cut tool (C)', exact: true}).click();
    const clip = page.getByRole('button', {name: 'Select rush', exact: true}); const box = (await clip.boundingBox())!;
    await page.mouse.click(box.x + 240, box.y + 30);
    await expect.poll(intervals).toEqual([[0, 300, 0], [300, 900, 300]]);
    await expect(page.getByRole('button', {name: 'Select rush (split)', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('v'); await expect(page.getByRole('button', {name: 'Selection tool', exact: true})).toHaveAttribute('aria-pressed', 'true');
    const ruler = (await page.locator('.ruler-area').boundingBox())!;
    await page.mouse.click(ruler.x + 384, ruler.y + 12);
    const split = page.getByRole('button', {name: 'Split selected clip (S)', exact: true}); await expect(split).toBeEnabled();
    await split.focus(); await page.keyboard.press('s'); // Buttons must not swallow editing shortcuts.
    await expect.poll(intervals).toEqual([[0, 300, 0], [300, 180, 300], [480, 720, 480]]);
    await page.mouse.click(ruler.x + 480, ruler.y + 12); await split.click();
    await expect.poll(intervals).toEqual([[0, 300, 0], [300, 180, 300], [480, 120, 480], [600, 600, 600]]);
    const handle = page.getByRole('button', {name: 'Trim start of rush (split) (split) (split)', exact: true}); const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + 2, edge.y + 15); await page.mouse.down(); await page.mouse.move(edge.x + 98, edge.y + 15, {steps: 3}); await page.mouse.up();
    await expect.poll(intervals).toEqual([[0, 300, 0], [300, 180, 300], [480, 120, 480], [720, 480, 720]]);
    await page.getByRole('button', {name: 'Delete selected clip', exact: true}).click(); await expect(page.locator('.timeline-count')).toHaveText('3 clips');
    await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click(); await expect(page.locator('.timeline-count')).toHaveText('4 clips');
    await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click(); await expect.poll(intervals).toEqual([[0, 300, 0], [300, 180, 300], [480, 120, 480], [600, 600, 600]]);
    await page.getByRole('button', {name: 'Fit timeline', exact: true}).click();
    expect(await page.locator('.timeline-scroll').evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(2);
  } finally {await request.post('/api/projects', {data: {action: 'open', id: original.project.id, revision: (await snapshot()).project.revision}});}
});
