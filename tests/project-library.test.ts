import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectRepository} from '../server/repositories/project-repository';
import {canvasSettingsSchema} from '../shared/media-settings';

const directories: string[] = [];
async function setup() {const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-projects-')); directories.push(directory); const repo = new ProjectRepository(directory); await repo.init(); return {repo, directory};}
const settings = canvasSettingsSchema.parse({width: 720, height: 1280, fps: 60});
afterEach(async () => {await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));});
describe('saved projects', () => {
  it('preserves existing work and independent undo histories across new, save as, open and restart', async () => {
    const {repo, directory} = await setup(); const originalId = repo.snapshot().project.id;
    const edited = await repo.execute([{type: 'project.rename', name: 'Devlog original'}, {type: 'clip.update', id: 'title-1', patch: {text: 'ORIGINAL'}}], 0, 'editor', 'Original edit');
    const copy = await repo.manageProject({action: 'copy', name: 'Alternative / Windows: version', revision: edited.project.revision});
    expect(copy.project.id).not.toBe(originalId); expect(copy.project.clips).toEqual(edited.project.clips); expect(copy.project.assets).toEqual(edited.project.assets); expect(copy.canUndo).toBe(false);
    const changed = await repo.execute([{type: 'clip.update', id: 'title-1', patch: {text: 'COPY ONLY'}}], copy.project.revision, 'editor', 'Copy edit');
    const blank = await repo.manageProject({action: 'new', name: 'Fresh', settings, revision: changed.project.revision});
    expect(blank.project).toMatchObject({...settings, clips: [], assets: []}); expect(blank.project.tracks).toHaveLength(3); expect(blank.canUndo).toBe(false);
    const restarted = new ProjectRepository(directory); await restarted.init(); expect(restarted.snapshot()).toEqual(blank);
    expect((await restarted.listProjects()).projects.map(p => p.name)).toEqual(expect.arrayContaining(['Devlog original', 'Alternative / Windows: version', 'Fresh']));
    const original = await restarted.manageProject({action: 'open', id: originalId, revision: blank.project.revision});
    expect(original.project.clips).toEqual(edited.project.clips); expect(original.canUndo).toBe(true);
    const undone = await restarted.history('undo', original.project.revision, 'editor'); expect(undone.project.name).toBe('A world in the making');
    const reopened = await restarted.manageProject({action: 'open', id: copy.project.id, revision: undone.project.revision});
    expect(reopened.project.clips.find(c => c.id === 'title-1')?.text).toBe('COPY ONLY');
    const undoCopy = await restarted.history('undo', reopened.project.revision, 'editor'); expect(undoCopy.project.clips.find(c => c.id === 'title-1')?.text).toBe('ORIGINAL');
    expect((await readdir(path.join(directory, 'projects'))).every(name => /^[a-f0-9]{64}\.json$/.test(name))).toBe(true);
  });
  it('rejects stale edits and project switches, including after reopening the same project, and retains late imports in their source project', async () => {
    const {repo} = await setup(); const original = repo.snapshot().project;
    const outcomes = await Promise.allSettled([repo.manageProject({action: 'new', name: 'Winner', settings, revision: original.revision}), repo.manageProject({action: 'copy', name: 'Stale copy', revision: original.revision})]);
    expect(outcomes.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    await expect(repo.execute([{type: 'project.clear'}], original.revision, 'codex', 'Stale edit')).rejects.toThrow('Project changed');
    const active = repo.snapshot();
    const result = await repo.addImportedAsset({id: 'late-import', name: 'Late image', src: '/media/retained.png', kind: 'image', duration: 6}, original.id, 'editor');
    expect(result).toEqual(active); expect(repo.snapshot().project.assets).toEqual([]);
    const reopened = await repo.manageProject({action: 'open', id: original.id, revision: active.project.revision});
    expect(reopened.project.assets.some(a => a.id === 'late-import')).toBe(true);
    await expect(repo.execute([{type: 'project.clear'}], original.revision, 'editor', 'Old project revision')).rejects.toThrow();
    const undo = await repo.history('undo', reopened.project.revision, 'editor'); expect(undo.project.assets.some(a => a.id === 'late-import')).toBe(false);
    await expect(repo.manageProject({action: 'open', id: '../../outside', revision: undo.project.revision})).rejects.toThrow('not found'); expect(repo.snapshot()).toEqual(undo);
  });
  it('reads legacy work without replacing its file and leaves the active project intact if another saved project is corrupt', async () => {
    const {repo, directory} = await setup();
    const legacyFile = path.join(directory, 'project.json'); const legacy = JSON.parse(await readFile(legacyFile, 'utf8')); delete legacy.updatedAt; delete legacy.project.tracks;
    await writeFile(legacyFile, JSON.stringify(legacy)); const bytes = await readFile(legacyFile, 'utf8');
    const migrated = new ProjectRepository(directory); await migrated.init(); expect(await readFile(legacyFile, 'utf8')).toBe(bytes);
    expect((await migrated.listProjects()).projects[0].id).toBe(repo.snapshot().project.id);
    const blank = await migrated.manageProject({action: 'new', name: 'New', revision: migrated.snapshot().project.revision, settings});
    const catalogDir = path.join(directory, 'projects'); const files = await readdir(catalogDir);
    const oldFile = (await Promise.all(files.map(async file => ({file, id: JSON.parse(await readFile(path.join(catalogDir, file), 'utf8')).project.id})))).find(entry => entry.id === legacy.project.id)!;
    await writeFile(path.join(catalogDir, oldFile.file), '{broken');
    await expect(migrated.manageProject({action: 'open', id: legacy.project.id, revision: blank.project.revision})).rejects.toThrow();
    expect(migrated.snapshot()).toEqual(blank); expect(await readFile(path.join(catalogDir, oldFile.file), 'utf8')).toBe('{broken');
  });
});
