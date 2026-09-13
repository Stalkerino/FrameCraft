import {test, expect} from '@playwright/test';

// UI transport contract only: real Vulkan frames are checked separately by
// desktop:check -- amd|nvidia --run --video. No GPU is opened by Playwright.
test('native mode removes browser visuals, coalesces frame requests and keeps compatible playback available', async ({page}) => {
  test.setTimeout(20000);
  await page.addInitScript(() => {
    const state = {inFlight: 0, max: 0, frames: [] as number[]};
    Object.assign(window, {isTauri: true, nativeTest: state, __TAURI_INTERNALS__: {invoke: async (command: string, args: {frame?: number} = {}) => {
      if(command === 'surface_open') return {adapter: 'UI transport fixture', backend: 'Native test adapter', width: 640, height: 360, videoConnected: true};
      if(command === 'surface_frame') {
        state.inFlight++; state.max = Math.max(state.max, state.inFlight); state.frames.push(args.frame!);
        await new Promise(resolve => setTimeout(resolve, 100)); state.inFlight--;
      }
    }}});
  });
  await page.goto('/');
  await expect(page.locator('.preview__canvas [data-preview-clip]').first()).toBeVisible();
  await page.getByText('Desktop · native monitor', {exact: true}).click();
  await page.getByRole('button', {name: 'Use native GPU preview', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Use compatible preview', exact: true})).toBeEnabled();
  await expect(page.locator('.preview__canvas [data-preview-clip]')).toHaveCount(0);
  await expect(page.locator('.preview__canvas video')).toHaveCount(0);
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {nativeTest: {frames: number[]}}).nativeTest.frames.length)).toBeGreaterThan(3);
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  expect(await page.evaluate(() => (window as unknown as {nativeTest: {max: number}}).nativeTest.max)).toBe(1);
  await page.getByRole('button', {name: 'Use compatible preview', exact: true}).click();
  await expect(page.locator('.preview__canvas [data-preview-clip]').first()).toBeVisible();
});

test('a superseded native seek failure preserves the latest target and a current failure can retry', async ({page}) => {
  test.setTimeout(20000);
  await page.addInitScript(() => {
    const state = {frames: [] as number[], fail: -1, held: false, reject: undefined as undefined | (() => void)};
    Object.assign(window, {isTauri: true, nativeSeekTest: state, __TAURI_INTERNALS__: {invoke: async (command: string, args: {frame?: number} = {}) => {
      if(command === 'surface_open') return {adapter: 'UI fixture', backend: 'Native test adapter', width: 640, height: 360, videoConnected: true};
      if(command === 'surface_frame') {
        state.frames.push(args.frame!);
        if(state.fail === args.frame) {state.fail = -1; state.held = true; await new Promise((_, reject) => {state.reject = () => reject(new Error('Interrupted seek'));});}
      }
    }}});
  });
  await page.goto('/');
  await page.getByText('Desktop · native monitor', {exact: true}).click();
  await page.getByRole('button', {name: 'Use native GPU preview', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Use compatible preview', exact: true})).toBeEnabled();
  const failNext = (frame: number) => page.evaluate(frame => {const state = (window as any).nativeSeekTest; state.fail = frame; state.held = false;}, frame);
  const held = () => page.evaluate(() => (window as any).nativeSeekTest.held);
  const reject = () => page.evaluate(() => (window as any).nativeSeekTest.reject());
  await failNext(100);
  await page.locator('.ruler-area').click({position: {x: 160, y: 10}});
  await expect.poll(held).toBe(true);
  await page.locator('.ruler-area').click({position: {x: 200, y: 10}});
  await reject();
  await expect.poll(() => page.evaluate(() => (window as any).nativeSeekTest.frames.at(-1))).toBe(125);
  await expect(page.getByRole('button', {name: 'Retry native preview', exact: true})).toHaveCount(0);
  await failNext(188);
  await page.locator('.ruler-area').click({position: {x: 300, y: 10}});
  await expect.poll(held).toBe(true); await reject();
  await page.getByRole('button', {name: 'Retry native preview', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Retry native preview', exact: true})).toHaveCount(0);
  await expect(page.locator('.preview__canvas video')).toHaveCount(0);
});
