import {expect, it} from 'vitest';
import {summarizeVisuals, visualCutCommands, type VideoCut} from '../shared/visual-rush';
import {createDemo} from '../shared/demo';
import {applyCommand} from '../shared/project';
import {normalizeProjectTracks} from '../shared/tracks';
it('maps the full source and reports low-motion and visual changes without inventing semantic events', () => {
  const metrics = Array.from({length: 240}, (_, time) => ({time, motion: time < 20 ? 0 : time === 170 ? .7 : .04, brightness: time < 8 ? .01 : .5}));
  const result = summarizeVisuals(metrics, 240);
  expect(result.moments[0].start).toBe(0); expect(result.moments.at(-1)?.end).toBe(240); expect(result.moments.some(m => m.time === 170)).toBe(true);
  expect(result.cues).toEqual(expect.arrayContaining([{kind: 'dark', start: 0, end: 8}, {kind: 'low-motion', start: 1, end: 20}]));
  expect(result.moments.length).toBeLessThanOrEqual(48);
});
it('converts selected source ranges to frames and replaces only the requested track, rejecting stale proposals and wrong sources', () => {
  let project = normalizeProjectTracks(createDemo()); project.fps = 24;
  project.assets.push({id: 'rush', name: 'Rush', kind: 'video', src: '/media/rush.mp4', duration: 60});
  const proposal: VideoCut = {id: 'cut', version: 1, projectId: project.id, assetId: 'rush', reportId: 'report', title: 'Movement', goal: '', createdAt: '', shots: [{id: 'a', start: 2.5, end: 6.5, reason: 'First observed action', confidence: 'medium', evidence: [3]}, {id: 'b', start: 20, end: 22, reason: 'Second observed action', confidence: 'medium', evidence: [21]}]};
  const originalOverlays = project.clips.filter(c => c.track === 'text'); let id = 0;
  const input = {id: 'cut', version: 1, revision: 0, mode: 'replace-track' as const, trackId: 'visual', shotIds: ['b', 'a']};
  for(const command of visualCutCommands(project, proposal, input, () => `cut-${id++}`)) project = applyCommand(project, command);
  expect(project.clips.filter(c => c.track === 'text')).toEqual(originalOverlays);
  expect(project.clips.filter(c => c.track === 'visual').map(c => [c.start, c.sourceStart, c.duration])).toEqual([[0, 480, 48], [48, 60, 96]]);
  expect(() => visualCutCommands(project, proposal, {...input, version: 2}, () => 'x')).toThrow('changed');
  expect(() => visualCutCommands(project, {...proposal, projectId: 'other'}, input, () => 'x')).toThrow('another project');
  expect(() => visualCutCommands(project, proposal, {...input, shotIds: ['a', 'a']}, () => 'x')).toThrow('distinct');
  expect(() => visualCutCommands(project, {...proposal, shots: [{...proposal.shots[0], end: 100}]}, {...input, shotIds: undefined}, () => 'x')).toThrow('exceeds');
});
