import {afterEach, expect, it, vi} from 'vitest';
import {mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ProjectRepository} from '../server/repositories/project-repository';
import {ProjectRecoveryRepository} from '../server/repositories/project-recovery-repository';
import {MediaFileRepository} from '../server/repositories/media-file-repository';
import {MediaService} from '../server/services/media-service';
import {ProjectMediaService} from '../server/services/project-media-service';
import {ProjectTransferService} from '../server/services/project-transfer-service';
import {projectStorageKey, type StoredProject} from '../server/repositories/project-storage';
import {clipSchema, projectSchema} from '../shared/project';
import {presetStarters} from '../shared/preset-starters';

const directories: string[] = []; const transfers: ProjectTransferService[] = [];
afterEach(async () => {vi.restoreAllMocks(); transfers.splice(0).forEach(service => service.close()); await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-care-')); directories.push(directory);
  const repo = new ProjectRepository(directory); await repo.init();
  const files = new MediaFileRepository(path.join(directory, 'media')); await mkdir(path.join(directory, 'media'));
  const transfer = new ProjectTransferService(repo, files); transfers.push(transfer);
  return {directory, repo, files, transfer};
}
async function finish(transfer: ProjectTransferService, id: string) {
  await expect.poll(() => transfer.get(id).status).toMatch(/done|error|cancelled/); return transfer.get(id);
}
it('restores a checkpoint as one undo step, retains the preceding version and rejects stale or foreign IDs', async () => {
  const {repo} = await setup(); const before = repo.snapshot(); const checkpoint = await repo.saveCheckpoint(before.project.revision, 'Before edit');
  const edited = await repo.execute([{type: 'project.rename', name: 'Changed'}], before.project.revision, 'editor', 'Rename');
  const restored = await repo.restoreCheckpoint(edited.project.revision, checkpoint.id, 'codex');
  expect(restored.project.name).toBe(before.project.name); expect(restored.project.revision).toBe(edited.project.revision + 1);
  expect((await repo.history('undo', restored.project.revision, 'editor')).project.name).toBe('Changed');
  expect((await repo.listRecovery()).map(v => v.label)).toContain('Before restoring a checkpoint');
  await expect(repo.restoreCheckpoint(0, checkpoint.id, 'editor')).rejects.toThrow('Project changed');
  await expect(repo.restoreCheckpoint(repo.snapshot().project.revision, '../outside', 'editor')).rejects.toThrow('Invalid');
});
it('recovers a corrupt live file on restart and preserves its bytes for investigation', async () => {
  const {repo, directory} = await setup();
  await repo.execute([{type: 'project.rename', name: 'Protected edit'}], 0, 'editor', 'Rename');
  await repo.execute([{type: 'project.rename', name: 'Newest edit'}], 1, 'editor', 'Rename');
  await writeFile(path.join(directory, 'project.json'), '{interrupted');
  const restarted = new ProjectRepository(directory); await restarted.init();
  expect(restarted.snapshot().project.name).toBe('Protected edit'); expect(restarted.snapshot().recoveryNotice).toContain('Recovered');
  const damaged = (await readdir(directory)).find(name => name.startsWith('project-damaged-'))!;
  expect(await readFile(path.join(directory, damaged), 'utf8')).toBe('{interrupted');
});
it('bounds recovery versions without touching media or unrelated files', async () => {
  const {repo, directory} = await setup(); const root = path.join(directory, 'bounded'); const recovery = new ProjectRecoveryRepository(root, 2);
  const state: StoredProject = {project: repo.snapshot().project, past: [], future: [], activity: [], updatedAt: new Date().toISOString()};
  const folder = path.join(root, projectStorageKey(state.project.id)); await mkdir(folder, {recursive: true}); await writeFile(path.join(folder, 'keep.mp4'), 'original');
  for(let i = 0; i < 4; i++) await recovery.save(state, `Version ${i}`);
  expect(await recovery.list(state.project.id)).toHaveLength(2); expect(await readFile(path.join(folder, 'keep.mp4'), 'utf8')).toBe('original');
});
it('relinks shared video/audio references, invalidates old derivatives and rejects a shorter replacement atomically', async () => {
  const {repo, files} = await setup();
  await repo.execute([{type: 'clips.replace', clips: []}, {type: 'asset.add', asset: {id: 'v', name: 'Missing', kind: 'video', src: '/media/missing.mp4', previewSrc: '/media/old-preview.mp4', duration: 4}}, {type: 'asset.add', asset: {id: 'a', name: 'Linked audio', kind: 'audio', src: '/media/missing.mp4', duration: 4}},
    {type: 'clip.add', clip: clipSchema.parse({id: 'v1', name: 'Cut', kind: 'video', assetId: 'v', track: 'visual', start: 30, sourceStart: 30, duration: 60, linkId: 'av'})},
    {type: 'clip.add', clip: clipSchema.parse({id: 'a1', name: 'Sound', kind: 'audio', assetId: 'a', track: 'audio', start: 30, sourceStart: 30, duration: 60, linkId: 'av'})}], 0, 'editor', 'Media');
  const media = new MediaService(files); const imported = {id: 'copy', name: 'Replacement', kind: 'video' as const, src: '/media/replaced.mp4', duration: 4, hasAudio: true};
  vi.spyOn(media, 'import').mockResolvedValue(imported);
  const service = new ProjectMediaService(repo, files, media); const old = repo.snapshot();
  expect((await service.health()).media.find(a => a.assetId === 'v')?.status).toBe('missing');
  const next = await service.relink({revision: old.project.revision, assetId: 'v', filePath: path.resolve('replacement.mp4')}, 'editor');
  expect(next.project.clips).toEqual(old.project.clips);
  expect(next.project.assets.filter(a => ['v', 'a'].includes(a.id)).map(a => a.src)).toEqual([imported.src, imported.src]);
  expect(next.project.assets.find(a => a.id === 'v')?.previewSrc).toBeUndefined();
  vi.mocked(media.import).mockResolvedValue({...imported, duration: 1});
  await expect(service.relink({revision: next.project.revision, assetId: 'v', filePath: path.resolve('short.mp4')}, 'editor')).rejects.toThrow('Trim exceeds');
  expect(repo.snapshot()).toEqual(next);
});
it('round-trips a moved portable folder with deduplicated sources and embedded effects, without switching the active project', async () => {
  const {repo, directory, transfer, files} = await setup();
  await writeFile(path.join(directory, 'media', 'source.wav'), 'original audio bytes');
  const preset = presetStarters.find(p => p.definition.category !== 'transition')!;
  const project = projectSchema.parse({version: 1, id: 'portable-original', name: 'Portable', revision: 0, width: 640, height: 360, fps: 30,
    folders: [{id: 'sounds', name: 'Generated sounds', parentId: null}], markers: [{id: 'note', name: 'Opening', frame: 0}],
    assets: ['a', 'b'].map(id => ({id, name: id, kind: 'audio', src: '/media/source.wav', duration: 3, folderId: 'sounds'})),
    clips: [clipSchema.parse({id: 'audio', name: 'Audio', assetId: 'a', kind: 'audio', track: 'audio', start: 0, duration: 30}), clipSchema.parse({id: 'graphic', name: 'Recipe', kind: 'graphic', track: 'text', start: 0, duration: 30, graphic: {presetId: preset.id, version: 1, definition: preset.definition, values: {}, duration: 1}})]});
  await repo.addPackagedProject(project, 'editor'); await repo.manageProject({action: 'open', id: project.id, revision: repo.snapshot().project.revision});
  const active = repo.snapshot(); const destination = path.join(directory, 'portable folder');
  expect((await finish(transfer, transfer.export(destination, active.project.revision).id)).status).toBe('done');
  const manifest = JSON.parse(await readFile(path.join(destination, 'framecraft-project.json'), 'utf8'));
  expect(manifest.files).toHaveLength(1); expect(manifest.project.clips[1].graphic).toEqual(project.clips[1].graphic);
  const moved = path.join(directory, 'moved folder'); await rename(destination, moved);
  const job = await finish(transfer, transfer.import(moved, 'codex').id); expect(job.status, job.error).toBe('done');
  expect(repo.snapshot()).toEqual(active);
  const opened = await repo.manageProject({action: 'open', id: job.projectId, revision: active.project.revision});
  expect(opened.project.clips).toEqual(active.project.clips); expect(opened.project.markers).toEqual(active.project.markers); expect(opened.project.folders).toEqual(active.project.folders); expect(opened.project.assets[0].folderId).toBe('sounds'); expect(opened.project.assets[0].src).toBe(opened.project.assets[1].src);
  expect(await readFile(files.resolve(opened.project.assets[0].src), 'utf8')).toBe('original audio bytes');
  const refused = await finish(transfer, transfer.export(moved, opened.project.revision).id); expect(refused.status).toBe('error');
  manifest.files[0].sha256 = '0'.repeat(64); await writeFile(path.join(moved, 'framecraft-project.json'), JSON.stringify(manifest));
  const corrupt = await finish(transfer, transfer.import(moved, 'editor').id); expect(corrupt.status).toBe('error'); expect(corrupt.error).toContain('checksum');
  manifest.project.assets[0].src = '../outside.wav'; await writeFile(path.join(moved, 'framecraft-project.json'), JSON.stringify(manifest));
  expect((await finish(transfer, transfer.import(moved, 'editor').id)).status).toBe('error');
});
