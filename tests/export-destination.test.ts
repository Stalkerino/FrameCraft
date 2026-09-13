import {expect, it} from 'vitest';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {defaultExportPath, publishExport, requireUnusedExport, validateExportPath} from '../server/services/export-destination-service';
import {resolveRenderOutput} from '../server/services/render-output-service';

it('scopes defaults to project storage and validates explicit destination filenames', () => {
  const file = defaultExportPath(path.resolve('data'), {id: 'a', name: 'Demo: ../rush'}, 'mp4');
  expect(file).toMatch(/[\\/]projects[\\/][a-f0-9]{64}[\\/]exported[\\/]Demo/);
  expect(validateExportPath(file, 'mp4')).toBe(file);
  expect(() => validateExportPath('relative.mp4', 'mp4')).toThrow('absolute');
  expect(() => validateExportPath(path.resolve('wrong.mov'), 'mp4')).toThrow('.mp4');
});
it('publishes without overwriting and opens the actual custom export destination', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fc-destination-'));
  try {
    const source = path.join(directory, 'staged.mp4'); const destination = path.join(directory, 'chosen.mp4');
    await writeFile(source, 'new export'); await requireUnusedExport(destination); await publishExport(source, destination);
    await writeFile(source, 'second export');
    await expect(publishExport(source, destination)).rejects.toMatchObject({code: 'EEXIST'});
    expect(await readFile(destination, 'utf8')).toBe('new export');
    await expect(requireUnusedExport(destination)).rejects.toThrow('already exists');
    expect(await resolveRenderOutput({id: 'a', kind: 'video', revision: 1, status: 'done', progress: 1, outputPath: destination, url: '/api/render/a/file'}, '/unused')).toEqual({path: await realpath(destination)});
  } finally {await rm(directory, {recursive: true, force: true});}
});
