import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {expect, it} from 'vitest';
import {clipSchema, type Project} from '../shared/project';
import {exportSettingsSchema} from '../shared/media-settings';
import {speedAudioSections, speedClipContext, speedRecipeForDuration, speedRecipeSchema, speedTimeMap, tempoFilters} from '../shared/speed-ramping';
import {ProjectRepository} from '../server/repositories/project-repository';
import {MediaFileRepository} from '../server/repositories/media-file-repository';
import {MediaService} from '../server/services/media-service';
import {SpeedRampService} from '../server/services/speed-ramp-service';
import {ffmpegPath, ffprobePath, runProcess} from '../server/services/process-service';

it('integrates ramps, accounts for freeze time and derives exact duration recipes', () => {
  const linear = speedRecipeSchema.parse({points: [{frame: 0, speed: 1}, {frame: 24, speed: 2}]});
  expect(speedTimeMap(linear, 1, 24).totalSeconds).toBeCloseTo(Math.log(2), 9);
  const recipe = speedRecipeSchema.parse({speed: 2, holds: [{frame: 6, duration: 6}]});
  const map = speedTimeMap(recipe, 1, 24);
  expect(map.outputFrames).toBe(18);
  expect(map.sourceTime(.25)).toBeCloseTo(.25);
  expect(map.sourceTime(.5)).toBeCloseTo(.5);
  const context = {sourceAssetId: 'original', sourceStartSeconds: 0, sourceDurationSeconds: 1, sourceDurationFrames: 24, fps: 24, recipe, outputDurationFrames: 18};
  const stretched = speedRecipeForDuration(context, 36);
  expect(stretched.speed).toBe(1); expect(stretched.holds[0].duration).toBe(12);
  expect(speedTimeMap(stretched, 1, 24).outputFrames).toBe(36);
  expect(tempoFilters(.125)).toBe('atempo=0.5,atempo=0.5,atempo=0.5');
  const smooth = speedRecipeSchema.parse({points: [{frame: 0, speed: .125, easing: 'smoothstep'}, {frame: 120, speed: 8}], holds: [{frame: 60, duration: 12}]});
  const audio = speedAudioSections(smooth, 5, 24);
  expect(audio.reduce((sum, part) => sum + part.frames, 0)).toBe(speedTimeMap(smooth, 5, 24).outputFrames);
  expect(audio.filter(part => !part.hold).every(part => part.frames <= 5)).toBe(true);
  expect(audio.find(part => part.hold)?.frames).toBe(12);
  expect(() => speedTimeMap(speedRecipeSchema.parse({holds: [{frame: 24, duration: 1}]}), 1, 24)).toThrow('before its end');
});

it('resolves a cut on retimed media back to the original source without cumulative speed processing', () => {
  const project: Project = {version: 1, id: 'p', name: 'Speed', revision: 0, width: 64, height: 36, fps: 24, clips: [], assets: [
    {id: 'original', name: 'Original', kind: 'video', src: '/media/original.mp4', duration: 8},
    {id: 'processed', name: 'Processed', kind: 'video', src: '/media/processed.mp4', duration: 2, speedProcessing: {sourceAssetId: 'original', sourceStartSeconds: 2, sourceDurationSeconds: 4, fps: 24, recipe: speedRecipeSchema.parse({speed: 2}), outputDurationFrames: 48}},
  ]};
  const clip = clipSchema.parse({id: 'clip', name: 'Clip', kind: 'video', track: 'visual', assetId: 'processed', start: 0, sourceStart: 12, duration: 12});
  const context = speedClipContext(project, clip);
  expect(context.sourceAssetId).toBe('original'); expect(context.sourceStartSeconds).toBe(3); expect(context.sourceDurationSeconds).toBe(1);
  expect(speedTimeMap(context.recipe, 1, 24).outputFrames).toBe(12);
  expect(speedTimeMap(speedRecipeForDuration(context, 24), 1, 24).outputFrames).toBe(24);
  const full = speedClipContext(project, {...clip, sourceStart: 0, duration: 48});
  expect(full.recipe).toEqual(project.assets[1].speedProcessing!.recipe);
  project.assets[1].speedProcessing!.recipe = speedRecipeSchema.parse({points: [{frame: 0, speed: 1, easing: 'hold'}, {frame: 48, speed: 2}]});
  project.assets[1].speedProcessing!.outputDurationFrames = 72;
  const stepped = speedClipContext(project, {...clip, sourceStart: 24, duration: 36});
  expect(stepped.sourceDurationSeconds).toBe(2);
  expect(stepped.recipe.points[0].easing).toBe('hold');
  expect(speedTimeMap(stepped.recipe, 2, 24).outputFrames).toBe(36);
});

it('creates exact-frame local media with held video, silent freeze audio, reversible originals and stale-job protection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'framecraft-speed-test-'));
  const projects = new ProjectRepository(directory); const files = new MediaFileRepository(path.join(directory, 'media'));
  const media = new MediaService(files); const service = new SpeedRampService(projects, media, files, path.join(directory, 'cache'));
  const finished = async (id: string) => {
    for(let iteration = 0; iteration < 1000; iteration++) {const job = service.get(id); if(!['queued', 'processing'].includes(job.status)) return job; await setTimeout(10);}
    throw new Error('Speed job timed out');
  };
  try {
    await projects.init();
    await projects.manageProject({action: 'new', revision: projects.snapshot().project.revision, name: 'Speed fixture', settings: {width: 64, height: 64, fps: 24, backgroundColor: '#080c0e', masterVolume: 1}});
    const input = path.join(directory, 'source.mkv');
    await runProcess(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', "nullsrc=s=64x64:r=24:d=1,geq=lum='16+N*8':cb=128:cr=128", '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-threads', '1', '-y', input], 15000);
    const original = await media.import(input, 'source.mkv', projects.snapshot().project.id);
    await projects.execute([{type: 'asset.add', asset: original}, {type: 'clip.add', clip: clipSchema.parse({id: 'clip', name: 'Clip', kind: 'video', track: 'visual', assetId: original.id, start: 0, duration: 24})}, {type: 'project.export-settings', settings: exportSettingsSchema.parse({width: 64, height: 64, fps: 24, encoder: 'cpu'})}], projects.snapshot().project.revision, 'editor', 'Fixture');
    const before = projects.snapshot().project;
    const job = service.create({revision: before.revision, clipId: 'clip', recipe: speedRecipeSchema.parse({speed: 2, holds: [{frame: 6, duration: 6}]})}, 'editor');
    expect(await finished(job.id)).toMatchObject({status: 'done', outputDurationFrames: 18});
    const changed = projects.snapshot().project; const processed = changed.assets.find(asset => asset.id === changed.clips[0].assetId)!;
    expect(changed.revision).toBe(before.revision + 1); expect(changed.clips[0].duration).toBe(18);
    expect(changed.assets.find(asset => asset.id === original.id)).toEqual(original);
    expect(processed.speedProcessing?.sourceAssetId).toBe(original.id);
    const probe = JSON.parse(await runProcess(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', files.resolve(processed.src)], 15000));
    expect(Number(probe.streams[0].nb_read_frames)).toBe(18);
    const frames: Buffer[] = []; await runProcess(ffmpegPath(), ['-v', 'error', '-i', files.resolve(processed.src), '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], 15000, {onOutput: chunk => frames.push(chunk)});
    const pixels = Buffer.concat(frames); expect(pixels.length).toBe(18 * 3);
    expect(pixels.subarray(4 * 3, 5 * 3)).toEqual(pixels.subarray(7 * 3, 8 * 3));
    expect(pixels[15 * 3]).toBeGreaterThan(pixels[4 * 3] + 40);
    const sound: Buffer[] = []; await runProcess(ffmpegPath(), ['-v', 'error', '-i', files.resolve(processed.src), '-vn', '-ac', '1', '-f', 'f32le', '-'], 15000, {onOutput: chunk => sound.push(chunk)});
    const pcm = Buffer.concat(sound); let sum = 0; for(let sample = 11000; sample < 15000; sample++) sum += pcm.readFloatLE(sample * 4) ** 2;
    expect(Math.sqrt(sum / 4000)).toBeLessThan(.001);
    let crossings = 0; let movingEnergy = 0;
    for(let sample = 22000; sample < 32000; sample++) {
      const value = pcm.readFloatLE(sample * 4); movingEnergy += value ** 2;
      if(value > 0 && pcm.readFloatLE((sample - 1) * 4) <= 0) crossings++;
    }
    expect(Math.sqrt(movingEnergy / 10000)).toBeGreaterThan(.02);
    expect(crossings * 48000 / 10000).toBeCloseTo(440, -1);
    await projects.history('undo', changed.revision, 'editor'); expect(projects.snapshot().project.clips[0].assetId).toBe(original.id);
    await projects.history('redo', projects.snapshot().project.revision, 'editor');
    const reset = service.reset({revision: projects.snapshot().project.revision, clipId: 'clip'}, 'editor');
    expect(await finished(reset.id)).toMatchObject({status: 'done', outputDurationFrames: 24});
    expect(projects.snapshot().project.clips[0]).toMatchObject({assetId: original.id, duration: 24});
    const stale = service.create({revision: projects.snapshot().project.revision, clipId: 'clip', recipe: speedRecipeSchema.parse({speed: 2})}, 'editor');
    await projects.execute([{type: 'project.rename', name: 'Changed during processing'}], projects.snapshot().project.revision, 'editor', 'Change');
    expect(await finished(stale.id)).toMatchObject({status: 'error'});
    expect(projects.snapshot().project.clips[0].assetId).toBe(original.id);
    const cancelled = service.create({revision: projects.snapshot().project.revision, clipId: 'clip', recipe: speedRecipeSchema.parse({speed: 2})}, 'editor'); service.cancel(cancelled.id);
    expect(await finished(cancelled.id)).toMatchObject({status: 'cancelled'});
  } finally {service.close(); await rm(directory, {recursive: true, force: true});}
}, 30000);
