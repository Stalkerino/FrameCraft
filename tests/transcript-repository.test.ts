import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {TranscriptRepository} from '../server/repositories/transcript-repository';
import type {Transcript} from '../shared/transcript';
const directories: string[] = [];
afterEach(async () => {await Promise.all(directories.splice(0).map(d => rm(d, {recursive: true, force: true})));});
it('persists transcripts separately, rejects competing revisions and invalid timestamps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-transcript-')); directories.push(directory);
  const repo = new TranscriptRepository(directory); const doc: Transcript = {assetId: '../safe-id', revision: 0, language: 'french', model: 'fixture', updatedAt: '', words: [{id: 'word', start: 0, end: 1, text: 'Bonjour'}]};
  expect(await repo.get(doc.assetId)).toBeNull(); await repo.save(doc, 3, null);
  const reopened = new TranscriptRepository(directory); expect((await reopened.get(doc.assetId))?.words[0].text).toBe('Bonjour');
  const competing = await Promise.allSettled([repo.save({...doc, words: [{...doc.words[0], text: 'Salut'}]}, 3, 0), repo.save(doc, 3, 0)]);
  expect(competing.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  await expect(repo.save({...doc, words: [{...doc.words[0], end: 5}]}, 3, 1)).rejects.toThrow('timing');
  expect((await repo.get(doc.assetId))?.revision).toBe(1);
});
