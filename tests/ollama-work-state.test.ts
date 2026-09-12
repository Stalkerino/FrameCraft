import {expect, it} from 'vitest';
import {OllamaWorkState} from '../server/services/ollama-work-state';

const reportId = '88926f48-23b5-4ae7-bffa-6f704751c09f';
const archive = '6eaf1f63-ba1d-4d88-a152-ae6984d6054b';
const project = {id: 'project-1', name: 'Devlog', revision: 305, fps: 60, width: 2560, height: 1440, tracks: [{id: 'visual', name: 'Video 1', type: 'visual'}], assets: [{id: 'asset-1', kind: 'video', duration: 357.7, fps: 59.94}], clips: [{id: 'clip-1', trackId: 'visual', kind: 'video', assetId: 'asset-1', sourceStart: 120, start: 0, duration: 600, positionLocked: true}]};
const report = {id: reportId, assetId: 'asset-1', duration: 357.7, moments: Array.from({length: 45}, (_, i) => ({time: i * 7.5})), cues: []};
const sheet = {reportId, columns: 4, frames: [{index: 1, time: 99.5, timecode: '00:01:39.500'}, {index: 2, time: 106.5, timecode: '00:01:46.500'}]};

it('projects complete project and report identifiers, units and object references instead of clipped JSON', () => {
  const state = new OllamaWorkState();
  const result = state.observe('get_project', {}, {project: {...project, clips: Array.from({length: 30}, (_, i) => ({...project.clips[0], id: `clip-${i}`}))}, canUndo: true, context: {playhead: 27}}, archive)!;
  const projected = result.project as Record<string, unknown>;
  expect(projected).toMatchObject({id: 'project-1', revision: 305, fps: 60, durationFrames: 600, timelineTimeUnit: 'frames'});
  expect(projected.clips).toMatchObject({total: 30, nextOffset: 16, contextReference: archive, pointer: '/project/clips'});
  expect((projected.clips as {items: unknown[]}).items[0]).toMatchObject({id: 'clip-0', sourceStart: 120, positionLocked: true, pointer: '/project/clips/0'});
  expect(result.context).toEqual({playhead: 27});
  expect(state.observe('get_video_analysis', {}, {reports: [report], cuts: []}, archive)).toMatchObject({reports: {total: 1, items: [{id: reportId, duration: 357.7, overviewPages: 4, momentCount: 45, pointer: '/reports/0'}]}});
});
it('retains exact observations across compaction and restart, validates evidence and releases lost-image gates', () => {
  const state = new OllamaWorkState(); state.observe('get_project', {}, {project}); state.observe('get_video_analysis', {}, report, archive);
  const inspection = state.observe('inspect_video', {inspection: {reportId, page: 1}}, sheet)!;
  expect(inspection.frames).toEqual(sheet.frames); expect(state.pendingInspection()).toEqual({reportId, page: 1, frames: [99.5, 106.5]});
  expect(() => state.recordObservations({reportId, observations: [{time: 99.6, description: 'Loadout menu', confidence: 'high'}]})).toThrow('not returned');
  state.recordObservations({reportId, observations: [{time: 99.5, description: 'Loadout menu is visible; small text is unclear.', confidence: 'medium'}]});
  expect(state.pendingInspection()).toMatchObject({frames: [106.5]});
  expect(state.read({section: 'reports', reportId})).toMatchObject({items: [{notedPages: []}]});
  const final = state.recordObservations({reportId, observations: [{time: 106.5, description: 'The same menu remains visible.', confidence: 'medium'}]});
  expect(final.remainingTimes).toEqual([]);
  expect(state.pendingInspection()).toBeNull();
  state.observe('inspect_video', {reportId, page: 2}, {...sheet, frames: [{index: 1, time: 200}]});
  const restored = new OllamaWorkState(); restored.restore(state.serialize());
  expect(restored.pendingInspection()).toBeNull();
  expect(restored.read({section: 'observations', reportId})).toMatchObject({items: expect.arrayContaining([{reportId, time: 99.5, description: 'Loadout menu is visible; small text is unclear.', confidence: 'medium'}])});
  expect(restored.read({section: 'reports', reportId})).toMatchObject({items: [{returnedPages: [1, 2], notedPages: [1], inspectedTimes: [99.5, 106.5, 200]}]});
  expect(restored.prompt()).toContain('Loadout menu is visible');
});
it('keeps original goals when the user continues and pages complete requests and observations', () => {
  const state = new OllamaWorkState(); state.request('Keep original sound and show every feature.'); state.observe('get_project', {}, {project});
  for(let i = 0; i < 20; i++) state.request(`Adjustment ${i}`);
  state.request('Continue');
  const prompt = state.prompt(3000);
  expect(prompt).toContain('Keep original sound and show every feature.'); expect(prompt).toContain('Continue'); expect(prompt.length).toBeLessThanOrEqual(3000);
  expect(state.read({section: 'requests', offset: 1, limit: 2})).toMatchObject({total: 22, items: [{text: 'Adjustment 0'}, {text: 'Adjustment 1'}], nextOffset: 3});
  state.request('x'.repeat(20000));
  expect(state.prompt(3000).length).toBeLessThanOrEqual(3000);
  expect(state.read({section: 'requests', offset: 22, limit: 1})).toMatchObject({items: [{text: 'x'.repeat(20000)}], nextOffset: null});
});
it('scopes evidence to its project and does not mark text-only results as visible images', () => {
  const state = new OllamaWorkState(); state.observe('get_project', {}, {project}); state.observe('inspect_video', {reportId, page: 1}, sheet, undefined, false);
  expect(state.pendingInspection()).toBeNull();
  expect(() => state.recordObservations({reportId, observations: [{time: 99.5, description: 'Unseen frame', confidence: 'low'}]})).toThrow('No image input');
  state.observe('inspect_video', {reportId, page: 1}, sheet);
  state.recordObservations({reportId, observations: [{time: 99.5, description: 'Historical note', confidence: 'low'}]});
  state.observe('get_project', {}, {project: {...project, id: 'project-2'}});
  expect(state.read({section: 'observations'})).toMatchObject({total: 0});
  expect(() => state.recordObservations({reportId, observations: [{time: 99.5, description: 'Wrong project', confidence: 'high'}]})).toThrow('No frames');
  expect(state.observe('get_analysis', {}, {status: 'working'})).toBeUndefined();
});
it('indexes earlier scenes chronologically and identifies omitted note ranges with exact retrieval offsets', () => {
  const state = new OllamaWorkState(); state.observe('get_project', {}, {project});
  for(let page = 0; page < 12; page++) {
    const times = Array.from({length: 12}, (_, i) => page * 12 + i);
    state.observe('inspect_video', {reportId, page}, {reportId, frames: times.map(time => ({time}))});
    state.recordObservations({reportId, observations: times.map(time => ({time, description: `Scene ${time}. ${'Visible detail. '.repeat(20)}`, confidence: 'medium'}))});
  }
  const prompt = state.prompt(5000); expect(prompt.length).toBeLessThanOrEqual(5000);
  const view = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  expect(view.observations.total).toBe(144); expect(view.observations.items[0].time).toBe(0); expect(view.observations.omittedCount).toBeGreaterThan(0);
  const range = view.observations.omittedRanges[0];
  expect(state.read({section: 'observations', offset: range.firstOffset, limit: 1})).toMatchObject({items: [{time: range.startTime, description: expect.stringContaining(`Scene ${range.startTime}.`)}]});
  expect(view.observations.items.every((note: {description: string}) => note.description.length <= 140)).toBe(true);
});
