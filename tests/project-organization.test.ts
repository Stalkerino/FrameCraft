import {expect, it} from 'vitest';
import {applyCommand, clipSchema, projectSchema} from '../shared/project';
import {folderOptions} from '../shared/project-organization';
const project = () => projectSchema.parse({version: 1, id: 'p', name: 'Organization', revision: 0, width: 640, height: 360, fps: 30,
  assets: [{id: 'a', name: 'Source', kind: 'audio', duration: 30, src: '/media/source.wav'}],
  clips: [clipSchema.parse({id: 'c', name: 'Sound', kind: 'audio', track: 'audio', assetId: 'a', start: 0, duration: 300})],
  markers: [{id: 'first', name: 'First', frame: 45}, {id: 'inside', name: 'Deleted', frame: 75}, {id: 'range', name: 'Range', frame: 30, end: 120}, {id: 'later', name: 'Later', frame: 150}, {id: 'future', name: 'Future', frame: 450}]});
it('rejects invalid marker ranges and preserves marker timing through FPS conversion', () => {
  const p = project();
  expect(() => applyCommand(p, {type: 'marker.set', marker: {id: 'bad', name: 'Bad', frame: 30, end: 30, color: '#ffffff', note: ''}})).toThrow('end must follow');
  const next = applyCommand(p, {type: 'project.settings', settings: {width: 640, height: 360, fps: 60, backgroundColor: '#000000', masterVolume: 1}});
  expect(next.markers?.find(m => m.id === 'range')).toMatchObject({frame: 60, end: 240});
  expect(p.markers?.find(m => m.id === 'range')?.end).toBe(120);
});
it('moves and trims global markers with ripple cuts, retaining notes after the footage ends', () => {
  const next = applyCommand(project(), {type: 'timeline.edit-ranges', operation: 'remove', ranges: [{start: 60, end: 90}]});
  expect(next.markers?.map(m => [m.id, m.frame, m.end ?? null])).toEqual([['range', 30, 90], ['first', 45, null], ['later', 120, null], ['future', 420, null]]);
  expect(applyCommand(project(), {type: 'clip.trim', id: 'c', edge: 'end', delta: 30, ripple: true, linked: true}).markers?.find(m => m.id === 'future')?.frame).toBe(480);
});
it('duplicates markers during assembly and keeps global notes fixed for partial-track edits', () => {
  const p = project();
  const assembled = applyCommand(p, {type: 'timeline.edit-ranges', operation: 'assemble', ranges: [{start: 30, end: 60}, {start: 30, end: 60}]});
  expect(assembled.markers?.filter(m => m.name === 'First').map(m => m.frame)).toEqual([15, 45]);
  expect(new Set(assembled.markers?.map(m => m.id)).size).toBe(assembled.markers?.length);
  const partial = applyCommand(p, {type: 'timeline.edit-ranges', operation: 'remove', ranges: [{start: 60, end: 90}], trackIds: ['audio']});
  expect(partial.markers).toEqual(p.markers);
});
it('inserts marker time and clears markers with the complete timeline', () => {
  const p = project(); const clip = clipSchema.parse({...p.clips[0], id: 'insert', start: 60, duration: 30});
  const next = applyCommand(p, {type: 'timeline.place', clip, mode: 'insert'});
  expect(next.markers?.find(m => m.id === 'range')).toMatchObject({frame: 30, end: 150});
  expect(next.markers?.find(m => m.id === 'later')?.frame).toBe(180);
  expect(applyCommand(next, {type: 'project.clear'}).markers).toEqual([]);
});
it('organizes media without touching clips, rejects folder cycles and reparents contents on deletion', () => {
  let p = project();
  p = applyCommand(p, {type: 'folder.add', folder: {id: 'root', name: 'Rushes', parentId: null}});
  p = applyCommand(p, {type: 'folder.add', folder: {id: 'child', name: 'Day 1', parentId: 'root'}});
  p = applyCommand(p, {type: 'assets.move-folder', ids: ['a'], folderId: 'child'});
  expect(folderOptions(p.folders!)).toEqual([{id: 'root', label: 'Rushes'}, {id: 'child', label: 'Rushes / Day 1'}]);
  expect(() => applyCommand(p, {type: 'folder.update', id: 'root', patch: {parentId: 'child'}})).toThrow('themselves');
  expect(() => applyCommand(p, {type: 'assets.move-folder', ids: ['a'], folderId: 'missing'})).toThrow('does not exist');
  const next = applyCommand(p, {type: 'folder.remove', id: 'child'});
  expect(next.assets[0]).toMatchObject({folderId: 'root', src: p.assets[0].src}); expect(next.clips).toEqual(p.clips);
  expect(applyCommand(next, {type: 'folder.remove', id: 'root'}).assets[0].folderId).toBe(null);
});
