import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {clipSchema} from '../../shared/project';

// Explicit hardware validation: a software fallback must fail this test. The
// regular suite remains runnable on CI machines without a physical GPU.
test('CUDA resize and sparse alpha artwork preserve cuts, pixels, frames and audio', async ({request}) => {
  test.skip(process.env.FRAMECRAFT_TEST_GPU !== 'nvidia', 'Set FRAMECRAFT_TEST_GPU=nvidia on a machine with CUDA/NVENC.');
  const snapshot = async () => (await (await request.get('/api/project')).json()).project;
  const original = await snapshot();
  const created = await request.post('/api/projects', {data: {action: 'new', name: 'GPU pipeline', revision: original.revision,
    settings: {width: 640, height: 360, fps: 30}}});
  expect(created.ok()).toBe(true);
  const directory = path.resolve('test-results/gpu-export'); await mkdir(directory, {recursive: true});
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const source = path.join(directory, 'source.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-vf', "drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill,drawbox=x=0:y=0:w=160:h=180:color=green:t=fill:enable='gte(t,0.5)',drawbox=x=0:y=0:w=20:h=180:color=white:t=fill",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-t', '1', '-y', source], {windowsHide: true});
  try {
    expect((await request.post('/api/import-path', {data: {filePath: source}})).ok()).toBe(true);
    const current = await snapshot();
    expect((await request.post('/api/commands', {data: {revision: current.revision, commands: [{type: 'clips.replace', clips: [
      clipSchema.parse({id: 'cut-a', name: 'Later source', kind: 'video', assetId: current.assets[0].id, track: 'visual', start: 0, sourceStart: 15, duration: 6, scale: .8}),
      clipSchema.parse({id: 'cut-b', name: 'Earlier source', kind: 'video', assetId: current.assets[0].id, track: 'visual', start: 6, sourceStart: 0, duration: 6, scale: .8}),
      clipSchema.parse({id: 'art', name: 'Sparse artwork', kind: 'text', track: 'text', start: 3, duration: 6, text: 'GPU', x: 50, y: 45, fontSize: 44, animation: 'none', opacity: .5}),
    ]}]}})).ok()).toBe(true);
    const render = async (body: Record<string, unknown>) => {
      const response = await request.post('/api/render', {data: body}); expect(response.ok()).toBe(true);
      const {id} = await response.json();
      let job: {status: string; error?: string; url: string; detail?: string; warning?: string; encoder?: string} = {status: '', url: ''};
      const details = new Set<string>();
      await expect.poll(async () => {
        job = await (await request.get(`/api/render/${id}`)).json();
        if(job.detail) details.add(job.detail);
        return job.status;
      }, {timeout: 120000, intervals: [100]}).toMatch(/done|error/);
      expect(job.status, job.error).toBe('done');
      return {bytes: await (await request.get(job.url)).body(), job, details: [...details].join('\n')};
    };
    const output = path.join(directory, 'gpu.mp4');
    const video = await render({kind: 'video', settings: {width: 640, height: 360, fps: 30, encoder: 'nvidia', crf: 12, audio: true, endSeconds: .4}});
    expect(video.job.encoder).toBe('NVIDIA NVENC');
    expect(video.job.warning ?? '').not.toMatch(/CPU filters|CPU decoding|processing failed|processing stopped/);
    expect(video.details).toContain('GPU browser rendering');
    expect(video.details).toContain('CUDA scaling / positioning / artwork compositing');
    expect(video.details).toContain('video frames stay on GPU');
    await writeFile(output, video.bytes);
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], {windowsHide: true, maxBuffer: 16 * 1024 ** 2});
    const frameSize = 640 * 360 * 3; expect(raw.length).toBe(12 * frameSize);
    // Compare real shared-composition stills across the source cut and artwork
    // appearing/disappearing. A dropped alpha channel or shifted cut is visible.
    for(const frame of [0, 3, 5, 6, 8, 9, 11]) {
      const still = await render({kind: 'frame', frame});
      await writeFile(path.join(directory, `reference-${frame}.png`), still.bytes);
      const reference = await sharp(still.bytes).removeAlpha().raw().toBuffer();
      let difference = 0;
      for(let i = 0; i < frameSize; i++) difference += Math.abs(raw[frame * frameSize + i] - reference[i]);
      expect(difference / frameSize, `frame ${frame}`).toBeLessThan(8);
      let artworkDifference = 0;
      for(let y = 160; y < 215; y++) for(let x = 230; x < 430; x++) for(let channel = 0; channel < 3; channel++) {
        const i = (y * 640 + x) * 3 + channel;
        artworkDifference += Math.abs(raw[frame * frameSize + i] - reference[i]);
      }
      expect(artworkDifference / (55 * 200 * 3), `artwork at frame ${frame}`).toBeLessThan(12);
    }
    let artworkChange = 0;
    for(let i = 0; i < frameSize; i++) artworkChange += Math.abs(raw[3 * frameSize + i] - raw[i]);
    expect(artworkChange).toBeGreaterThan(10000);
    const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], {encoding: 'utf8', windowsHide: true}));
    const audio = probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'audio');
    expect(audio.sample_rate).toBe('48000'); expect(Number(audio.duration)).toBeCloseTo(.4, 2);
  } finally {
    await request.post('/api/projects', {data: {action: 'open', id: original.id, revision: (await snapshot()).revision}});
  }
});
