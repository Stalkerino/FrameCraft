import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyCommand, clipSchema, projectSchema, validateProject} from '../shared/project';
import {activeSequenceId, projectForSequence, sequenceSummaries} from '../shared/project-sequences';
import {defaultExportSettings} from '../shared/media-settings';
import {ProjectRepository} from '../server/repositories/project-repository';
import {planProjectRender} from '../server/services/render-plan-service';

const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));});
const project = () => projectSchema.parse({version: 1, id: 'p', name: 'Film', revision: 0, width: 640, height: 360, fps: 30,
  assets: [{id: 'a', name: 'Footage', kind: 'video', duration: 10, src: '/media/source.mp4'}],
  clips: [clipSchema.parse({id: 'c', name: 'Opening', kind: 'video', track: 'visual', assetId: 'a', start: 0, sourceStart: 60, duration: 120, positionLocked: true})],
  markers: [{id: 'm', name: 'Opening beat', frame: 45}], colorGrade: {exposure: 1}, masterVolume: .4});

it('opens a legacy timeline losslessly after creating a blank sequence, without inheriting grade, clips or export range', () => {
  const old = project(); old.exportSettings = {...defaultExportSettings(old), startSeconds: 1, endSeconds: 3};
  let next = applyCommand(old, {type: 'sequence.create', id: 'blank', name: 'Vertical', settings: {width: 360, height: 640, fps: 60, backgroundColor: '#102030', masterVolume: 1}});
  expect(next).toMatchObject({id: 'p', name: 'Film', sequenceId: 'blank', width: 360, height: 640, fps: 60, clips: [], markers: [], masterVolume: 1});
  expect(next.colorGrade).toBeUndefined(); expect(next.exportSettings).toBeUndefined(); expect(next.assets).toEqual(old.assets);
  expect(projectForSequence(next, 'main').clips).toEqual(old.clips);
  next = applyCommand(next, {type: 'sequence.open', id: 'main'});
  for(const key of ['clips', 'tracks', 'markers', 'colorGrade', 'exportSettings', 'fps', 'width', 'height', 'masterVolume'] as const) expect(next[key]).toEqual(old[key]);
  expect(next.sequences?.map(s => s.id)).toEqual(['blank']); expect(activeSequenceId(old)).toBe('main'); expect(old.sequences).toBeUndefined();
});

it('duplicates all edits independently, preserves source/animation timing at another FPS, and scopes position locks to one sequence', () => {
  const old = project(); old.clips[0].keyframes = {opacity: [{frame: 0, value: 0, easing: 'linear'}, {frame: 30, value: 1, easing: 'linear'}]};
  let next = applyCommand(old, {type: 'sequence.create', id: 'copy', name: 'Alternate', sourceId: 'main', settings: {width: 640, height: 360, fps: 60, backgroundColor: '#000000', masterVolume: .4}});
  expect(next.clips[0]).toMatchObject({sourceStart: 120, duration: 240, keyframes: {opacity: [{frame: 0}, {frame: 60}]}});
  expect(next.markers?.[0].frame).toBe(90);
  next = applyCommand(next, {type: 'clip.update', id: 'c', patch: {positionLocked: false, x: 20}});
  next = applyCommand(next, {type: 'clip.update', id: 'c', patch: {positionLocked: true}});
  next = applyCommand(next, {type: 'sequence.open', id: 'main'});
  expect(next.clips[0].x).toBe(50); expect(next.clips[0].keyframes).toEqual(old.clips[0].keyframes);
  expect(() => applyCommand(next, {type: 'clip.update', id: 'c', patch: {x: 30}})).toThrow('Position is locked');
  expect(projectForSequence(next, 'copy').clips[0].x).toBe(20);
});

it('validates all inactive timelines against shared media, including shorter relinks and duplicate IDs', () => {
  const next = applyCommand(project(), {type: 'sequence.create', id: 'blank', name: 'Blank'});
  expect(() => validateProject({...next, assets: [{...next.assets[0], duration: 1}]})).toThrow('source duration');
  expect(() => validateProject({...next, sequences: [...next.sequences!, next.sequences![0]]})).toThrow('Duplicate sequence ID');
  expect(() => applyCommand(next, {type: 'sequence.create', id: 'main', name: 'Duplicate'})).toThrow('Duplicate sequence ID');
  expect(() => applyCommand(next, {type: 'sequence.open', id: 'missing'})).toThrow('no longer exists');
  expect(() => applyCommand(project(), {type: 'sequence.remove', id: 'main'})).toThrow('at least one');
  const renamed = applyCommand(next, {type: 'sequence.rename', id: 'main', name: 'Original'});
  expect(sequenceSummaries(renamed).find(s => s.id === 'main')).toMatchObject({name: 'Original', clipCount: 1, durationSeconds: 4});
  const removed = applyCommand(renamed, {type: 'sequence.remove', id: 'blank'});
  expect(activeSequenceId(removed)).toBe('main'); expect(removed.clips).toEqual(project().clips); expect(removed.assets).toEqual(next.assets);
});

it('projects inactive sequences for export planning without switching or carrying unrelated timelines', () => {
  const next = applyCommand(project(), {type: 'sequence.create', id: 'blank', name: 'Blank'});
  const projected = projectForSequence(next, 'main');
  expect(projected.sequences).toBeUndefined(); expect(projected.fps).toBe(30); expect(projected.id).toBe(next.id);
  projected.clips[0].duration = 1;
  expect(next.sequences?.[0].clips[0].duration).toBe(120);
  expect(() => planProjectRender(next, {sequenceId: 'main', settings: {...defaultExportSettings(project()), startSeconds: 2, endSeconds: 3}})).not.toThrow();
  expect(() => planProjectRender(next, {sequenceId: 'blank', settings: {...defaultExportSettings(project()), startSeconds: 2, endSeconds: 3}})).toThrow('range');
  expect(activeSequenceId(next)).toBe('blank');
});

it('persists inactive sequences and shared imports across restart, undo/redo and checkpoint restore', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-sequences-')); directories.push(directory);
  const repository = new ProjectRepository(directory); await repository.init();
  const original = repository.snapshot().project;
  await repository.execute([{type: 'sequence.create', id: 'copy', name: 'Alternate', sourceId: 'main'}, {type: 'project.clear'}], original.revision, 'editor', 'Create alternate');
  const checkpoint = await repository.saveCheckpoint(repository.snapshot().project.revision, 'Two sequences');
  await repository.execute([{type: 'asset.add', asset: {id: 'shared', kind: 'image', name: 'Shared', src: '/media/shared.png', duration: 1}}], repository.snapshot().project.revision, 'codex', 'Import');
  const reloaded = new ProjectRepository(directory); await reloaded.init();
  expect(reloaded.snapshot().project.sequences?.[0].clips).toEqual(original.clips);
  expect(projectForSequence(reloaded.snapshot().project, 'main').assets.at(-1)?.id).toBe('shared');
  await reloaded.execute([{type: 'sequence.remove', id: 'main'}], reloaded.snapshot().project.revision, 'editor', 'Remove');
  await reloaded.history('undo', reloaded.snapshot().project.revision, 'editor');
  expect(reloaded.snapshot().project.sequences).toHaveLength(1);
  await reloaded.history('redo', reloaded.snapshot().project.revision, 'editor');
  expect(reloaded.snapshot().project.sequences).toHaveLength(0);
  await reloaded.restoreCheckpoint(reloaded.snapshot().project.revision, checkpoint.id, 'editor');
  expect(reloaded.snapshot().project.sequences?.[0].clips).toEqual(original.clips);
  expect(reloaded.snapshot().project.clips).toEqual([]);
});
