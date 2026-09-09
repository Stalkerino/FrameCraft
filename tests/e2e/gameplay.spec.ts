import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('visually inspects silent gameplay, saves a reviewable cut through MCP and applies it with undo', async ({page, request}) => {
  const snapshot = async () => (await (await request.get('/api/project')).json()); const initial = await snapshot();
  const create = await request.post('/api/projects', {data: {action: 'new', name: 'Silent gameplay', revision: initial.project.revision, settings: {width: 640, height: 360, fps: 24}}}); expect(create.ok()).toBe(true);
  const directory = path.resolve('test-results/gameplay'); await mkdir(directory, {recursive: true}); const source = path.join(directory, 'silent rush.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=24:d=4', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=4', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=24:d=4', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], {stdio: 'ignore'});
  const imported = await request.post('/api/import-path', {data: {filePath: source}}); expect(imported.ok()).toBe(true); const asset = (await imported.json()).project.assets[0];
  const client = new Client({name: 'visual-gameplay-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async (name: string, args: Record<string, unknown>) => {const result = await client.callTool({name, arguments: args}, undefined, {timeout: 120000}); expect(result.isError, JSON.stringify(result)).not.toBe(true); return result;};
  const data = (result: unknown) => JSON.parse((result as {content: {text: string}[]}).content[0].text);
  try {
    await page.goto('/'); await page.getByRole('button', {name: 'Tools', exact: true}).click(); await page.getByRole('button', {name: 'Gameplay cuts', exact: true}).click(); await page.getByRole('button', {name: 'Scan gameplay', exact: true}).click();
    await expect(page.getByText('Visual map ready', {exact: true})).toBeVisible({timeout: 60000}); const catalog = data(await call('get_video_analysis', {})); const report = catalog.reports[0];
    expect(report.assetId).toBe(asset.id); expect(report.cues.some((cue: {kind: string}) => cue.kind === 'dark')).toBe(true); expect((await snapshot()).project.clips).toHaveLength(0);
    const overview = await call('inspect_video', {inspection: {reportId: report.id, page: 0}}); expect((overview.content as {type: string}[]).some(item => item.type === 'image')).toBe(true);
    const detail = await call('inspect_video', {inspection: {reportId: report.id, start: 4, end: 8}}); const detailData = data(detail); expect(detailData.frames.map((frame: {time: number}) => frame.time)).toContain(5);
    const image = (detail.content as {type: string; data?: string}[]).find(item => item.type === 'image')!; await writeFile(path.join(directory, 'sequence.jpg'), Buffer.from(image.data!, 'base64'));
    const larger = await call('inspect_video', {inspection: {reportId: report.id, time: 5}}); expect(data(larger).columns).toBe(1);
    const extra = data(await call('inspect_video', {inspection: {reportId: report.id, start: 4.125, end: 7.875}}));
    const evidence = [...detailData.frames, ...extra.frames].map((frame: {time: number}) => frame.time); expect(evidence.length).toBeGreaterThan(12);
    const proposalInput = {reportId: report.id, revision: (await snapshot()).project.revision, expectedVersion: null, title: 'Observed motion section', goal: 'Explicit test proposal based on generated fixture footage', shots: [{id: 'keep-action', start: 4, end: 8, reason: 'The inspected fixture shows moving shapes here; the surrounding sections are static.', confidence: 'high', evidence}]};
    const uninspected = await request.post('/api/visual-rush/cuts', {data: {...proposalInput, shots: [{...proposalInput.shots[0], evidence: [5.123]}]}}); expect(uninspected.ok()).toBe(false);
    const proposal = data(await call('save_video_cut', proposalInput)); await expect(page.getByText('Observed motion section', {exact: true})).toBeVisible();
    expect(proposal.shots[0].evidence).toEqual(evidence);
    await page.getByRole('button', {name: 'Preview gameplay shot 1'}).click(); await expect(page.locator('.source-preview video')).toBeVisible(); await page.getByRole('button', {name: 'Apply gameplay cut', exact: true}).click();
    await expect.poll(async () => (await snapshot()).project.clips.map((clip: {sourceStart: number; duration: number}) => [clip.sourceStart, clip.duration])).toEqual([[96, 96]]);
    await page.screenshot({path: 'test-results/gameplay/review.png'}); await page.getByRole('button', {name: 'Undo timeline edit (Ctrl+Z)', exact: true}).click(); await expect.poll(async () => (await snapshot()).project.clips.length).toBe(0);
    await call('apply_video_cut', {id: proposal.id, version: proposal.version, revision: (await snapshot()).project.revision, mode: 'append'});
    const frame = await call('render_frame', {frame: 24}); expect((frame.content as {type: string}[]).some(item => item.type === 'image')).toBe(true);
    await page.reload(); await page.getByRole('button', {name: 'Tools', exact: true}).click(); await page.getByRole('button', {name: 'Gameplay cuts', exact: true}).click(); await expect(page.getByText('Observed motion section', {exact: true})).toBeVisible();
    await page.getByRole('textbox', {name: 'Gameplay editing goal'}).fill('Show movement mechanics'); await page.getByRole('button', {name: 'Review in Codex', exact: true}).click(); await expect(page.getByRole('textbox', {name: 'Message Codex'})).toHaveValue(/Show movement mechanics/);
    // The protocol peer verifies one-click sending; semantic quality is not simulated or claimed here.
    const draft = await page.getByRole('textbox', {name: 'Message Codex'}).inputValue();
    const sent = page.waitForRequest(request => request.url().endsWith('/api/agent/chat/message') && request.method() === 'POST');
    await page.getByRole('button', {name: 'Generate and apply cuts', exact: true}).click();
    const prompt = (await sent).postDataJSON().text;
    expect(prompt).toContain('Show movement mechanics'); expect(prompt).toContain('mode="replace-track"'); expect(prompt).toContain('trackId="visual"'); expect(prompt).toContain('inspect_video'); expect(prompt).toContain(asset.id);
    await expect(page.getByRole('textbox', {name: 'Message Codex'})).toHaveValue(draft);
    await expect(page.getByRole('button', {name: 'Send', exact: true})).toBeEnabled();
    expect((await (await request.get('/api/analysis/transcripts')).json())).toEqual([]);
  } finally {await client.close(); await request.post('/api/projects', {data: {action: 'open', id: initial.project.id, revision: (await snapshot()).project.revision}});}
});
