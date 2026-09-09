import {expect, test} from '@playwright/test';

test('live streams reconnect after navigating away while updates are arriving', async ({page, request}) => {
  for(let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/');
    const events = await page.evaluate(async () => Promise.all(
      ['/api/events', '/api/agent/chat/events', '/api/asset-presets/events'].map(url => new Promise<string>((resolve, reject) => {
        const stream = new EventSource(url);
        const timeout = setTimeout(() => {stream.close(); reject(new Error(`No snapshot from ${url}`));}, 5000);
        stream.onmessage = message => {clearTimeout(timeout); resolve(message.data);};
        stream.onerror = () => {clearTimeout(timeout); stream.close(); reject(new Error(`Stream failed: ${url}`));};
        // Keep streams open until navigation closes their browser connections.
      })),
    ));
    expect(events).toHaveLength(3);
    for(const value of events) expect(JSON.parse(value)).toBeTruthy();
    await page.goto('about:blank');
  }
  expect((await request.get('/api/project')).ok()).toBe(true);
});
