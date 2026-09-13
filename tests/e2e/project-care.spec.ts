import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import type {Project, Snapshot} from '../../shared/project';
import type {ProjectTransferJob, RecoveryVersion, MediaHealth} from '../../shared/project-care';

test('protects a project, relinks missing media and moves a portable project through UI and MCP', async ({page, request}) => {
  const directory = await mkdtemp(path.resolve('.cache/project-care-'));
  const source = path.join(directory, 'tone.wav');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-threads', '1', source]);
  const client = new Client({name: 'project-care-test', version: '1'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await client.callTool({name, arguments: args}); expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content as {text?: string}[]).find(item => item.text)?.text ?? '{}');
  };
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const finish = async (id: string) => {
    let job: ProjectTransferJob;
    await expect.poll(async () => {job = await call<ProjectTransferJob>('get_project_transfer', {id}); return job.status;}).toMatch(/done|error/);
    expect(job!.status, job!.error).toBe('done'); return job!;
  };
  try {
    await call('manage_project', {operation: {action: 'new', revision: (await project()).revision, name: 'Portable test', settings: {width: 640, height: 360, fps: 30}}});
    await call('import_media', {filePath: source}); let current = await project(); const asset = current.assets[0];
    await call('edit_project', {revision: current.revision, label: 'Cut audio', commands: [{type: 'clip.add', clip: {id: 'sound', name: 'Cut sound', kind: 'audio', assetId: asset.id, track: 'audio', start: 15, duration: 30, sourceStart: 15}}]});
    current = await project();
    const checkpoint = await call<RecoveryVersion>('save_project_checkpoint', {revision: current.revision, label: 'Before rename'});
    await call('edit_project', {revision: current.revision, label: 'Rename', commands: [{type: 'project.rename', name: 'Changed name'}]});
    await page.goto('/'); await page.getByRole('button', {name: 'Project menu', exact: true}).click();
    await page.getByRole('button', {name: 'Project safety & portability'}).click();
    await page.locator('.project-care__list article').filter({hasText: 'Before rename'}).getByRole('button', {name: 'Restore', exact: true}).click();
    await expect.poll(async () => (await project()).name).toBe('Portable test');
    expect((await call<RecoveryVersion[]>('list_project_versions')).some(v => v.id === checkpoint.id)).toBe(true);
    const health = await call<MediaHealth>('check_project_media');
    const oldPath = health.media[0].filePath!;
    // This file belongs only to the isolated test project.
    await rename(oldPath, path.join(directory, 'moved-original.wav'));
    await page.getByRole('button', {name: 'Media files', exact: true}).click(); await page.getByRole('button', {name: 'Check files'}).click();
    await expect(page.locator('.project-care__missing')).toContainText('missing');
    await page.getByRole('button', {name: 'Choose replacement'}).click();
    await page.getByLabel('Replacement file path').fill(source); await page.getByRole('button', {name: 'Replace media', exact: true}).click();
    await expect.poll(async () => (await project()).assets[0].src).not.toBe(asset.src);
    const relinked = await project(); expect(relinked.clips).toEqual(current.clips);
    const destination = path.join(directory, 'portable');
    await page.getByRole('button', {name: 'Portable project', exact: true}).click();
    await page.getByLabel('Portable project folder').fill(destination); await page.getByRole('button', {name: 'Create portable project', exact: true}).click();
    await expect(page.getByText('Ready to move to another computer.')).toBeVisible();
    const moved = path.join(directory, 'another machine'); await rename(destination, moved);
    const imported = await finish((await call<ProjectTransferJob>('import_project_package', {directory: moved})).id);
    expect((await project()).id).toBe(relinked.id);
    const opened = await call<Snapshot>('manage_project', {operation: {action: 'open', id: imported.projectId, revision: (await project()).revision}});
    expect(opened.project.clips).toEqual(relinked.clips);
    expect((await request.get(opened.project.assets[0].src)).status()).toBe(200);
    expect((await call<MediaHealth>('check_project_media')).media.every(item => item.status === 'available')).toBe(true);
  } finally {await client.close(); await rm(directory, {recursive: true, force: true});}
});
