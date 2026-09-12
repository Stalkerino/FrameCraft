import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {clipSchema} from '../../shared/project';

// CPU only: verify visual parity without exercising display-driver/VPP paths.
test('native crop, translation, scale and canvas gaps match the shared composition', async ({request}) => {
  const snapshot = async () => (await (await request.get('/api/project')).json()).project;
  const original = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'Native geometry', revision: original.revision, settings: {width: 320, height: 180, fps: 30}}});
  expect(created.ok()).toBe(true);
  const directory = path.resolve('test-results/native-geometry'); await mkdir(directory, {recursive: true});
  const source = path.join(directory, 'source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=1', '-vf', 'drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-an', '-y', source]);
  expect((await request.post('/api/import-path', {data: {filePath: source}})).ok()).toBe(true);
  const current = await snapshot();
  expect((await request.post('/api/commands', {data: {revision: current.revision, commands: [{type: 'clips.replace', clips: [
    clipSchema.parse({id: 'video', name: 'Cropped video', kind: 'video', assetId: current.assets[0].id, track: 'visual', start: 3, duration: 6, x: 55, y: 45, scale: .8, crop: {left: 10, top: 10, right: 10, bottom: 10}}),
    clipSchema.parse({id: 'label', name: 'Label', kind: 'text', track: 'text', start: 0, duration: 12, text: 'CROP', x: 5, y: 5, fontSize: 14, animation: 'none'}),
  ]}]}})).ok()).toBe(true);
  const render = async (body: Record<string, unknown>) => {
    const result = await request.post('/api/render', {data: body}); expect(result.ok()).toBe(true);
    const {id} = await result.json();
    let job: {status: string; error?: string; url: string; detail?: string} = {status: '', url: ''};
    await expect.poll(async () => {job = await (await request.get(`/api/render/${id}`)).json(); return job.status;}, {timeout: 90000}).toMatch(/done|error/);
    expect(job.status, job.error).toBe('done');
    return (await request.get(job.url)).body();
  };
  const still = await render({kind: 'frame', frame: 5});
  const video = await render({kind: 'video', settings: {width: 320, height: 180, fps: 30, encoder: 'cpu', preset: 'ultrafast', audio: false, endSeconds: .4}});
  const output = path.join(directory, 'output.mp4'); await writeFile(output, video);
  const raw = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', output, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], {maxBuffer: 4 * 1024 ** 2});
  const bytesPerFrame = 320 * 180 * 3; expect(raw.length).toBe(12 * bytesPerFrame);
  const reference = await sharp(still).removeAlpha().raw().toBuffer();
  const pixel = (buffer: Buffer, frame: number, x: number, y: number) => [...buffer.subarray(frame * bytesPerFrame + (y * 320 + x) * 3, frame * bytesPerFrame + (y * 320 + x) * 3 + 3)];
  for(const [x, y] of [[20, 90], [100, 90], [230, 90], [300, 90], [100, 170]]) {
    const expected = pixel(reference, 0, x, y); const actual = pixel(raw, 5, x, y);
    for(let c = 0; c < 3; c++) expect(Math.abs(expected[c] - actual[c]), `pixel ${x},${y}`).toBeLessThanOrEqual(12);
  }
  for(const frame of [0, 2, 9, 11]) expect(Math.max(...pixel(raw, frame, 160, 90))).toBeLessThan(25);
  expect(pixel(raw, 3, 100, 90)[0]).toBeGreaterThan(180);
  expect(pixel(raw, 8, 230, 90)[2]).toBeGreaterThan(180);
});
