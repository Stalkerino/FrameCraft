import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AnalysisService} from '../server/services/analysis-service';
import {TranscriptRepository} from '../server/repositories/transcript-repository';
import type {InferenceProvider} from '../server/services/inference-service';
import {createDemo} from '../shared/demo';
const directories: string[] = []; const services: AnalysisService[] = [];
afterEach(async () => {services.splice(0).forEach(s => s.close()); await Promise.all(directories.splice(0).map(d => rm(d, {recursive: true, force: true})));});
async function setup(provider: InferenceProvider) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'framecraft-analysis-')); directories.push(dir);
  const transcripts = new TranscriptRepository(path.join(dir, 'transcripts'));
  const service = new AnalysisService(transcripts, provider, {data: dir, media: dir, cache: path.join(dir, 'models')}); services.push(service); return {service, transcripts};
}
it('queues semantic search, persists embeddings and invalidates corrected passages', async () => {
  const calls: string[][] = [];
  const provider: InferenceProvider = {run: async input => {
    if(input.kind !== 'embedding') throw new Error('Unexpected transcription'); calls.push(input.texts);
    return {model: 'explicit-unit-test-provider', vectors: input.texts.map(text => /combat|fighting/.test(text) ? [1, 0] : [0, 1])};
  }};
  const {service, transcripts} = await setup(provider); const project = createDemo(); project.clips = [];
  project.assets = [{id: 'video', name: 'devlog.mp4', kind: 'video', src: '/media/devlog.mp4', duration: 10}, {id: 'image', name: 'landscape.png', kind: 'image', src: '/media/landscape.png', duration: 6}];
  const doc = await transcripts.save({assetId: 'video', revision: 0, updatedAt: '', language: 'english', model: 'fixture', words: [{id: 'w', text: 'combat.', start: 1, end: 2}]}, 10, null);
  const first = service.search(project, 'fighting'); await expect.poll(() => service.jobs.get(first.id)?.status).toBe('done');
  expect(service.jobs.get(first.id)?.results?.map(h => [h.assetId, h.match, h.start])).toEqual([['video', 'transcript', 1], ['image', 'filename', 0]]);
  const second = service.search(project, 'fighting'); await expect.poll(() => service.jobs.get(second.id)?.status).toBe('done'); expect(calls[1]).toEqual(['fighting']);
  await transcripts.save({...doc, words: [{...doc.words[0], text: 'lighting.'}]}, 10, 0);
  const third = service.search(project, 'fighting'); await expect.poll(() => service.jobs.get(third.id)?.status).toBe('done'); expect(calls[2]).toEqual(['fighting', 'lighting.']);
});
it('cancels queued and running analyses and lets later work continue', async () => {
  let calls = 0;
  const provider: InferenceProvider = {run: async (_input, signal) => {calls++; return new Promise((resolve, reject) => {signal.addEventListener('abort', () => reject(new Error('cancelled')), {once: true}); if(calls > 1) resolve({model: 'fixture', vectors: [[1], [1], [1], [1]]});});}};
  const {service} = await setup(provider); const project = createDemo();
  const first = service.search(project, 'world'); const queued = service.search(project, 'build'); service.cancel(queued.id);
  await expect.poll(() => calls).toBe(1); service.cancel(first.id);
  expect(service.jobs.get(first.id)?.status).toBe('cancelled'); expect(service.jobs.get(queued.id)?.status).toBe('cancelled');
  const third = service.search(project, 'world'); await expect.poll(() => service.jobs.get(third.id)?.status).toBe('done'); expect(calls).toBe(2);
});
