import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('shows initialized idle MCP sessions before any tool is called and clears closed sessions', async ({page, request}) => {
  await page.goto('/'); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  await expect(page.getByText('Waiting for a Codex session', {exact: true})).toBeVisible();
  const before = await (await request.get('/api/status')).json(); expect(before.agentLastSeen).toBeNull();
  const client = new Client({name: 'idle-connection-test', version: '1.0.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}});
  try {
    await client.connect(transport);
    await expect(page.getByText('Codex connected', {exact: true})).toBeVisible();
    const active = await (await request.get('/api/status')).json(); expect(active.agentLastSeen).toBeNull();
    expect(active.agentConnections[0].clientName).toBe('idle-connection-test');
    const firstHeartbeat = active.agentConnections[0].lastSeen;
    await expect.poll(async () => (await (await request.get('/api/status')).json()).agentConnections[0]?.lastSeen, {timeout: 15_000}).not.toBe(firstHeartbeat);
    expect((await (await request.get('/api/status')).json()).agentLastSeen).toBeNull();
    expect((await (await request.get('/api/project')).json()).project.revision).toBe(0);
    await page.route('**/api/status', route => route.abort());
    await expect(page.getByText('Editor service unavailable', {exact: true})).toBeVisible();
    await page.unroute('**/api/status');
    await expect(page.getByText('Codex connected', {exact: true})).toBeVisible();
  } finally {await client.close();}
  await expect(page.getByText('Waiting for a Codex session', {exact: true})).toBeVisible();
});

test('manual editing, shared Codex tools, import, persistence, frame inspection, and MP4 export', async ({page, request}) => {
  // LAN HTTP does not expose randomUUID; additions and splits must still work.
  await page.addInitScript(() => {Object.defineProperty(crypto, 'randomUUID', {value: undefined, configurable: true});});
  const pageErrors: string[] = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByRole('textbox', {name: 'Text content'})).toBeVisible();
  await page.getByRole('textbox', {name: 'Text content'}).fill('A TEST DEVLOG');
  await page.getByRole('spinbutton', {name: 'Position X', exact: true}).click();
  await expect.poll(async () => (await (await request.get('/api/project')).json()).project.clips.find((c: {id: string}) => c.id === 'title-1').text).toBe('A TEST DEVLOG');
  await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Text content'})).toHaveValue('A WORLD\nIN THE MAKING.');

  const transport = new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}});
  const client = new Client({name: 'framecraft-integration-test', version: '1.0.0'});
  await client.connect(transport);
  try {
    const tools = await client.listTools(); expect(tools.tools.map(t => t.name)).toContain('render_frame');
    const current = await client.callTool({name: 'get_project', arguments: {}});
    const data = JSON.parse((current.content as {text: string}[])[0].text);
    const edit = await client.callTool({name: 'edit_project', arguments: {revision: data.project.revision, label: 'Codex changed the title', commands: [{type: 'clip.update', id: 'title-1', patch: {text: 'EDITED BY CODEX'}}]}});
    expect(edit.isError).not.toBe(true);
    await expect(page.getByRole('textbox', {name: 'Text content'})).toHaveValue('EDITED BY CODEX');
    await page.reload();
    await expect(page.getByRole('textbox', {name: 'Text content'})).toHaveValue('EDITED BY CODEX');
    // Exercise a custom transition with the actual renderer while demo scenes are still present.
    const transitionFrame = await client.callTool({name: 'render_frame', arguments: {frame: 190}}, undefined, {timeout: 120_000});
    expect(transitionFrame.isError).not.toBe(true);
    expect((transitionFrame.content as {type: string}[]).some(item => item.type === 'image')).toBe(true);

    // Exercise pointer movement and trim handles, including frame quantization.
    const title = page.getByRole('button', {name: 'Select Opening title', exact: true});
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 12); await page.mouse.down(); await page.keyboard.down('Alt'); await page.mouse.move(box.x + 88, box.y + 12, {steps: 8}); await page.mouse.up(); await page.keyboard.up('Alt');
    await expect.poll(async () => (await (await request.get('/api/project')).json()).project.clips.find((c: {id: string}) => c.id === 'title-1').start).toBe(42);
    const handle = page.getByRole('button', {name: 'Trim end of Opening title'}); const end = (await handle.boundingBox())!;
    await page.mouse.move(end.x + 2, end.y + 6); await page.mouse.down(); await page.mouse.move(end.x - 30, end.y + 6, {steps: 5}); await page.mouse.up();
    await expect.poll(async () => (await (await request.get('/api/project')).json()).project.clips.find((c: {id: string}) => c.id === 'title-1').duration).toBe(125);

    const directory = path.resolve('test-results/fixtures with spaces'); await mkdir(directory, {recursive: true});
    const source = path.join(directory, 'devlog sample.mp4');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], {stdio: 'ignore'});
    await page.locator('input[type=file]').setInputFiles(source);
    await expect(page.getByRole('button', {name: 'Add devlog sample.mp4 to timeline', exact: true})).toBeVisible({timeout: 45_000});
    await page.getByRole('button', {name: 'Project menu', exact: true}).click(); await page.getByRole('button', {name: /^Start a blank timeline/}).click(); await page.getByRole('button', {name: 'Clear timeline', exact: true}).click();
    await expect(page.locator('.timeline-count')).toHaveText('0 clips');
    await page.getByRole('button', {name: 'Add devlog sample.mp4 to timeline', exact: true}).click();
    await expect(page.locator('.timeline-count')).toHaveText('1 clips');
    await page.getByRole('button', {name: 'Play', exact: true}).click();
    await expect.poll(async () => await page.locator('.timecode').textContent()).not.toContain('00:00:00');
    await page.getByRole('button', {name: 'Pause', exact: true}).click();
    await page.getByRole('button', {name: 'Go to beginning', exact: true}).click();
    await page.evaluate(() => {if(document.activeElement instanceof HTMLElement) document.activeElement.blur();});
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.timecode')).toContainText('00:00:01');
    await expect.poll(async () => await page.locator('video').first().evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(1 / 30, 2);
    await page.getByRole('button', {name: 'Go to beginning', exact: true}).click();
    await page.getByRole('button', {name: 'Titles', exact: true}).click(); await page.getByRole('button', {name: /^Title Heading/}).click();
    await expect(page.getByRole('textbox', {name: 'Text content'})).toBeVisible();
    await page.getByRole('spinbutton', {name: 'Duration', exact: true}).fill('1.5'); await page.getByRole('spinbutton', {name: 'Duration', exact: true}).press('Enter');
    await expect(page.getByRole('spinbutton', {name: 'Duration', exact: true})).toHaveValue('1.5');

    // MCP frame output must be an actual image, not only a URL or a mocked response.
    const rendered = await client.callTool({name: 'render_frame', arguments: {frame: 20}}, undefined, {timeout: 120_000});
    expect(rendered.isError).not.toBe(true);
    const content = rendered.content as {type: string; data?: string; text?: string}[];
    expect(content.some(item => item.type === 'image' && item.data!.length > 1000)).toBe(true);
    await page.getByRole('button', {name: 'Export video', exact: true}).click(); await page.getByRole('button', {name: 'Export now', exact: true}).click();
    await expect(page.getByText('Your story is ready to share')).toBeVisible({timeout: 120_000});
    const link = page.getByRole('link', {name: 'Download video'}); const url = await link.getAttribute('href');
    const download = await request.get(url!); expect(download.status()).toBe(200); const buffer = await download.body(); expect(buffer.subarray(4, 8).toString()).toBe('ftyp');
    const {writeFile} = await import('node:fs/promises'); const exported = path.join(directory, 'export.mp4'); await writeFile(exported, buffer);
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', exported], {encoding: 'utf8'}));
    expect(probe.streams.find((s: {codec_type: string}) => s.codec_type === 'video').width).toBe(1920);
    expect(probe.streams.some((s: {codec_type: string}) => s.codec_type === 'audio')).toBe(true);
    expect(Number(probe.format.duration)).toBeCloseTo(2, 1);
    await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
    await expect(page.getByText('Codex connected', {exact: true})).toBeVisible();
    await page.getByRole('tab', {name: 'Activity', exact: true}).click();
    await expect(page.getByText('Codex changed the title')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {await client.close();}
});

test('rejects unrelated browser origins and stale revision writes', async ({request}) => {
  const blocked = await request.post('/api/commands', {headers: {Origin: 'https://unrelated.example'}, data: {commands: [{type: 'project.clear'}], revision: 0}}); expect(blocked.status()).toBe(403);
  const stale = await request.post('/api/commands', {data: {commands: [{type: 'project.clear'}], revision: -1}}); expect(stale.status()).toBe(409);
  const invalid = await request.post('/api/render', {data: {kind: 'frame', frame: -1}}); expect(invalid.status()).toBe(400);
});
