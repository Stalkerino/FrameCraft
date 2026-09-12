import {it, expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createDemo} from '../shared/demo';
import {applyCommand, durationOf} from '../shared/project';
import {cachedInspection, inspectionCacheKey, inspectionTimes, inspectVideoSchema, saveVideoCutSchema, applyVideoCutSchema, visualCutCommands, type VisualReport, type VideoCut} from '../shared/visual-rush';
import {VisualRushService} from '../server/services/visual-rush-service';

it('retains more than 12 citations and 100 shots, including cached evidence after a restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-cut-limits-'));
  try {
    const service = new VisualRushService({data: directory, media: path.join(directory, 'media')});
    const project = createDemo(); project.assets.push({id: 'long-rush', name: 'Long rush', kind: 'video', src: '/media/rush.mp4', duration: 8000});
    const report: VisualReport = {version: 1, id: randomUUID(), assetId: 'long-rush', assetName: 'Long rush', duration: 8000, sampleInterval: 1, createdAt: '', moments: [], cues: []};
    await service.repository.saveReport(report);
    const evidence: number[] = [];
    for(const start of [4, 5]) {
      const inspection = {reportId: report.id, start, end: start + 16};
      const folder = path.join(service.repository.directory, 'images', report.id, inspectionCacheKey(inspection)); await mkdir(folder, {recursive: true});
      // Fixture models a completed inspection cache; this test does not perform visual analysis.
      await writeFile(path.join(folder, 'sheet.jpg'), 'completed inspection fixture'); evidence.push(...inspectionTimes(report, inspection));
    }
    const input = saveVideoCutSchema.parse({revision: project.revision, reportId: report.id, title: 'Detailed cut '.repeat(20), goal: 'Editing goal. '.repeat(100), shots: Array.from({length: 101}, (_, i) => ({id: `shot-${i}`, start: 4, end: 21, reason: 'Observed context. '.repeat(50), confidence: 'medium', evidence}))});
    const saved = await service.save(project, input); expect(saved.shots).toEqual(input.shots); expect(saved.title).toBe(input.title); expect(saved.goal).toBe(input.goal);
    const restarted = new VisualRushService({data: directory, media: path.join(directory, 'media')});
    const updated = await restarted.save(project, {...input, id: saved.id, expectedVersion: saved.version});
    expect(updated.shots[0].evidence).toEqual(evidence); expect(updated.shots).toHaveLength(101);
    await expect(restarted.save(project, {...input, shots: [{...input.shots[0], evidence: [5.123]}]})).rejects.toThrow('Inspect the cited');
    await expect(restarted.save(project, {...input, shots: [{...input.shots[0], evidence: [22]}]})).rejects.toThrow('shots[0].evidence[0]');
    expect(inspectVideoSchema.parse({reportId: report.id, start: 1, end: 7900}).end).toBe(7900);
    const tiny = {reportId: report.id, start: 1e-7, end: 2e-7}; expect(cachedInspection(report.id, inspectionCacheKey(tiny))).toEqual(tiny);
  } finally {await rm(directory, {recursive: true, force: true});}
});

it('applies more than 5000 shots in one transaction without hitting command or project caps', () => {
  const project = createDemo(); project.clips = []; project.assets.push({id: 'rush', name: 'Rush', kind: 'video', src: '/media/rush.mp4', duration: 2});
  const proposal: VideoCut = {id: randomUUID(), version: 1, projectId: project.id, reportId: randomUUID(), assetId: 'rush', title: 'Long proposal '.repeat(20), goal: '', createdAt: '', shots: Array.from({length: 5001}, (_, i) => ({id: `shot-${i}`, start: 0, end: 1, reason: 'Fixture', confidence: 'high', evidence: [0]}))};
  const input = applyVideoCutSchema.parse({id: proposal.id, version: 1, revision: project.revision, mode: 'append', shotIds: proposal.shots.map(s => s.id)}); let id = 0;
  const commands = visualCutCommands(project, proposal, input, () => `cut-${id++}`); expect(commands).toHaveLength(1);
  const next = applyCommand(project, commands[0]); expect(next.clips).toHaveLength(5001); expect(durationOf(next)).toBe(5001 * project.fps);
});
