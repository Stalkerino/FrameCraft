import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {expect, it} from 'vitest';
import {ffmpegPath, runProcess} from '../server/services/process-service';
import {sceneAudioArguments, sceneAudioGraph} from '../server/services/rendering/vulkan-scene-commands';
import {exportSettingsSchema} from '../shared/media-settings';

it('mixes real resampled audio with exact duration and without automatic gain reduction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-scene-audio-'));
  try {
    const settings = exportSettingsSchema.parse({width: 320, height: 180, fps: 30});
    const inputs = [];
    for(const [index, frequency] of [240, 720].entries()) {
      const file = path.join(directory, `${index}.wav`);
      await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=${index ? 44100 : 48000}:duration=0.3`, '-c:a', 'pcm_s16le', '-y', file], 10000);
      inputs.push({file, segment: {clipId: String(index), name: 'Audio', start: 0, duration: 3, sourceStart: 1, volume: .5,
        ...(index ? {audioGains: [{volume: .5, envelope: {duration: 9, offset: 0, fadeIn: 0, fadeOut: 0, keyframes: [{frame: 0, value: .5}]}}, {volume: .8}]} : {}),
        asset: {id: String(index), name: 'Audio', kind: 'audio' as const, src: '/media/audio.wav', duration: .3}}});
    }
    const graph = path.join(directory, 'mix.txt'); const output = path.join(directory, 'mix.wav');
    await writeFile(graph, sceneAudioGraph(inputs, settings, 4800));
    await runProcess(ffmpegPath(), sceneAudioArguments(inputs, settings, graph, output), 10000);
    const chunks: Buffer[] = [];
    await runProcess(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', output, '-ac', '1', '-f', 'f32le', '-'], 10000, {onOutput: chunk => {chunks.push(chunk);}});
    const samples = Buffer.concat(chunks);
    expect(samples.length).toBe(4800 * 4);
    for(const frequency of [240, 720]) {
      let projection = 0;
      for(let n = 100; n < 4700; n++) projection += samples.readFloatLE(n * 4) * Math.sin(2 * Math.PI * frequency * n / 48000);
      expect(projection * 2 / 4600).toBeCloseTo(frequency === 240 ? .0625 : .0125, 3);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});
