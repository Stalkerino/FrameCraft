import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectRepository} from '../server/repositories/project-repository';

const directories: string[] = [];
async function setup() {const dir = await mkdtemp(path.join(os.tmpdir(), 'framecraft-repository-')); directories.push(dir); const repo = new ProjectRepository(dir); await repo.init(); return {repo, dir};}
afterEach(async () => {await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});
describe('persistent transactions', () => {
  it('commits a batch once, persists it, and preserves undo and redo across restart', async () => {
    const {repo, dir} = await setup();
    const result = await repo.execute([{type: 'project.rename', name: 'New project'}, {type: 'clip.remove', id: 'title-1'}], 0, 'codex', 'Updated opening');
    expect(result.project.revision).toBe(1); expect(result.canUndo).toBe(true);
    const reopened = new ProjectRepository(dir); await reopened.init();
    expect(reopened.snapshot()).toEqual(result);
    const undone = await reopened.history('undo', 1, 'editor');
    expect(undone.project.name).toBe('A world in the making'); expect(undone.project.clips.some(c => c.id === 'title-1')).toBe(true);
    expect(undone.project.revision).toBe(2);
    const redone = await reopened.history('redo', 2, 'codex'); expect(redone.project.name).toBe('New project');
  });
  it('does not save partially valid batches', async () => {
    const {repo} = await setup(); const initial = repo.snapshot();
    await expect(repo.execute([{type: 'project.rename', name: 'Do not save'}, {type: 'clip.remove', id: 'missing'}], 0, 'codex', 'Invalid batch')).rejects.toThrow();
    expect(repo.snapshot()).toEqual(initial);
  });
  it('serializes concurrent writes and rejects stale edits without losing the winner', async () => {
    const {repo} = await setup();
    const results = await Promise.allSettled([repo.execute([{type: 'project.rename', name: 'First'}], 0, 'editor', 'First'), repo.execute([{type: 'project.rename', name: 'Second'}], 0, 'codex', 'Second')]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(repo.snapshot().project.name).toBe('First');
  });
  it('preserves a corrupted project when no recovery copy is available', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'framecraft-unrecoverable-')); directories.push(dir);
    await writeFile(path.join(dir, 'project.json'), '{broken');
    await expect(new ProjectRepository(dir).init()).rejects.toThrow('preserved');
    expect(await readFile(path.join(dir, 'project.json'), 'utf8')).toBe('{broken');
  });
});
