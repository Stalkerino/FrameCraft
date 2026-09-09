import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {clipSchema, type Snapshot} from '../../shared/project';

test('plays and seeks trimmed cuts, releasing old decoders and recovering a stalled cut without reloading', async ({page, request}) => {
  const snapshot = async (): Promise<Snapshot> => (await request.get('/api/project')).json();
  const original = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'Steady preview', revision: original.project.revision, settings: {width: 640, height: 360, fps: 60}}});
  expect(created.ok()).toBe(true);
  try {
    const directory = path.resolve('test-results/preview-playback'); await mkdir(directory, {recursive: true});
    const source = path.join(directory, 'continuous.mp4');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], {stdio: 'ignore'});
    const imported = await request.post('/api/import-path', {data: {filePath: source}}); expect(imported.ok()).toBe(true);
    const current = await snapshot();
    const added = await request.post('/api/commands', {data: {revision: current.project.revision, commands: [
      {type: 'clip.add', clip: clipSchema.parse({id: 'steady-video', name: 'Continuous segment', kind: 'video', assetId: current.project.assets[0].id, track: 'visual', start: 0, sourceStart: 120, duration: 900})},
      {type: 'clip.add', clip: clipSchema.parse({id: 'next-cut', name: 'Next trimmed segment', kind: 'video', assetId: current.project.assets[0].id, track: 'visual', start: 900, sourceStart: 600, duration: 480, transition: 'none'})},
    ]}});
    expect(added.ok()).toBe(true);
    await page.goto('/'); await page.getByRole('button', {name: 'Go to beginning', exact: true}).click();
    const video = page.locator('.preview__canvas video');
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.seeking)).toBe(true);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 2);
    // Observe the actual media clock, independently of the editor's playhead.
    await video.evaluate((element: HTMLVideoElement) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
      element.dataset.backwardSeeks = '0';
      Object.defineProperty(element, 'currentTime', {...descriptor, set(value: number) {
        if(value < descriptor.get!.call(element) - .1) element.dataset.backwardSeeks = String(Number(element.dataset.backwardSeeks) + 1);
        descriptor.set!.call(element, value);
      }});
    });
    await page.getByRole('button', {name: 'Play', exact: true}).click();
    const started = await page.evaluate(() => performance.now());
    await page.waitForTimeout(6000);
    const timing = await page.locator('.preview .timecode').evaluate(element => {
      const [minutes, seconds, frame] = element.textContent!.split(' / ')[0].split(':').map(Number);
      return {now: performance.now(), seconds: minutes * 60 + seconds + frame / 60};
    });
    expect(Math.abs(timing.seconds - (timing.now - started) / 1000)).toBeLessThan(.6);
    await expect(video).toHaveAttribute('data-backward-seeks', '0');
    const mediaTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    expect(Math.abs(mediaTime - 2 - timing.seconds)).toBeLessThan(.3);
    await page.getByRole('button', {name: 'Pause', exact: true}).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await page.getByRole('button', {name: 'Go to beginning', exact: true}).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 2);
    await page.evaluate(() => {if(document.activeElement instanceof HTMLElement) document.activeElement.blur();});
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.preview .timecode')).toContainText('00:00:01');
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2 + 1 / 60, 2);
    // A real failed media request must recover without refreshing the page or editing the timeline.
    let failedRequest = false;
    await page.route('**/project-media/**/media/**.mp4', async route => {
      if(!failedRequest) {failedRequest = true; await route.fulfill({status: 503, body: 'Temporary media failure'});}
      else await route.continue();
    });
    await video.evaluate((element: HTMLVideoElement) => element.load());
    await expect.poll(() => failedRequest).toBe(true);
    await expect.poll(() => video.count()).toBe(1);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.error), {timeout: 15000}).toBe(true);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2 + 1 / 60, 2);
    await page.getByRole('button', {name: 'Play', exact: true}).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2.5);
    await page.getByRole('button', {name: 'Pause', exact: true}).click();

    // Seek across a cut from the same rush, then play through that boundary.
    const outgoing = (await video.elementHandle())!;
    await page.locator('.ruler-area').click({position: {x: 14.5 * 48, y: 10}});
    await page.getByRole('button', {name: 'Play', exact: true}).click();
    const next = page.locator('.preview__canvas video[data-preview-clip="next-cut"]');
    await expect.poll(() => next.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(10.5);
    await expect.poll(() => outgoing.evaluate((element: HTMLVideoElement) => !element.isConnected && !element.getAttribute('src') && element.readyState === 0)).toBe(true);
    await page.getByRole('button', {name: 'Mute preview', exact: true}).click();

    // Model a decoder whose seek never completes. A new element must recover at
    // the same cut/playhead, still playing and muted, without a page navigation.
    const stuck = (await next.elementHandle())!;
    const stalledTime = await stuck.evaluate((element: HTMLVideoElement) => {
      Object.defineProperty(element, 'seeking', {get: () => true, configurable: true});
      element.dispatchEvent(new Event('seeking'));
      element.dispatchEvent(new Event('waiting'));
      return element.currentTime;
    });
    await expect.poll(() => stuck.evaluate(element => element.isConnected), {timeout: 12000}).toBe(false);
    await expect.poll(() => next.evaluate((element: HTMLVideoElement) => element.readyState >= 2 && !element.seeking && !element.paused && element.muted), {timeout: 12000}).toBe(true);
    const resumedTime = await next.evaluate((element: HTMLVideoElement) => element.currentTime);
    expect(resumedTime).toBeGreaterThanOrEqual(stalledTime - .3);
    expect(resumedTime).toBeLessThan(stalledTime + 2);
    await expect.poll(() => next.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(resumedTime + .3);
    await page.getByRole('button', {name: 'Pause', exact: true}).click();
    expect((await snapshot()).project.revision).toBe((await added.json()).project.revision);
  } finally {
    await request.post('/api/projects', {data: {action: 'open', id: original.project.id, revision: (await snapshot()).project.revision}});
  }
});
