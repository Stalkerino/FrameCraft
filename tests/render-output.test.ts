import {expect, it} from 'vitest';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveRenderOutput} from '../server/services/render-output-service';
import type {RenderJob} from '../shared/project';

it('opens only an existing completed export and reports missing or unfinished outputs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-output-'));
  const job: RenderJob = {id: 'test', kind: 'video', revision: 0, status: 'done', progress: 1, url: '/exports/test video.mp4'};
  try {
    const file = path.join(directory, 'test video.mp4');
    await writeFile(file, 'isolated output fixture');
    expect(await resolveRenderOutput(job, directory)).toEqual({path: await realpath(file)});
    await expect(resolveRenderOutput(undefined, directory)).rejects.toMatchObject({status: 404});
    await expect(resolveRenderOutput({...job, status: 'rendering'}, directory)).rejects.toMatchObject({status: 409});
    await expect(resolveRenderOutput({...job, url: '/exports/../outside.mp4'}, directory)).rejects.toThrow('Invalid export');
    await rm(file);
    await expect(resolveRenderOutput(job, directory)).rejects.toThrow('no longer available');
  } finally {await rm(directory, {recursive: true, force: true});}
});
