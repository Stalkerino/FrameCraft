import {test, expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {clipSchema, type Project} from '../../shared/project';
import type {AudioEffectJob} from '../../shared/audio-effects';

test('edits synchronized sections, places saved SFX and exports fades with processed audio through MCP', async ({page, request}) => {
  const project = async (): Promise<Project> => (await (await request.get('/api/project')).json()).project;
  const initial = await project();
  await request.post('/api/commands', {data: {revision: initial.revision, commands: [{type: 'project.clear'}, {type: 'project.settings', settings: {width: 640, height: 360, fps: 30}}]}});
  const directory = path.resolve('.cache/e2e-audio-input'); await mkdir(directory, {recursive: true});
  const file = path.join(directory, 'two-camera-source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-y', file]);
  const client = new Client({name: 'timeline-audio-test', version: '1.0.0'});
  await client.connect(new StdioClientTransport({command: process.execPath, args: [path.resolve('scripts/mcp.mjs')], env: {...process.env as Record<string, string>, FRAMECRAFT_URL: 'http://127.0.0.1:4319'}}));
  const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({name, arguments: args}, undefined, {timeout: 120000});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content as {type: string; text: string}[]).find(item => item.type === 'text')!.text);
  };
  try {
    await call('import_media', {filePath: file}); const imported = await project(); const asset = imported.assets.find(item => item.name === path.basename(file))!;
    await call('edit_project', {revision: imported.revision, label: 'Two synchronized camera tracks', commands: [
      {type: 'track.add', track: {id: 'camera-two', type: 'visual', name: 'Camera two'}},
      {type: 'clips.replace', clips: [
        clipSchema.parse({id: 'camera-a', name: 'Camera A first', kind: 'video', assetId: asset.id, track: 'visual', start: 0, duration: 45, volume: 0}),
        clipSchema.parse({id: 'camera-b', name: 'Camera A second', kind: 'video', assetId: asset.id, track: 'visual', start: 45, duration: 45, sourceStart: 45, volume: 0}),
        clipSchema.parse({id: 'camera-top', name: 'Camera two', kind: 'video', assetId: asset.id, track: 'visual', trackId: 'camera-two', start: 0, duration: 90, volume: .5, audioEnvelope: {duration: 90, fadeIn: 12, fadeOut: 12}}),
      ]},
    ]});
    const sounds = await call<{sounds: {id: string; version: number}[]}>('list_sound_presets', {});
    expect(sounds.sounds.length).toBeGreaterThanOrEqual(12);
    const sound = sounds.sounds.find(item => item.id === 'impact-soft')!;
    const preview = await call<{src: string}>('preview_sound_preset', {...sound, values: {}});
    expect((await (await request.get(preview.src)).body()).subarray(0, 4).toString()).toBe('RIFF');
    await call('apply_sound_preset', {...sound, revision: (await project()).revision, frame: 45, values: {}, durationFrames: 12});
    const before = await project();
    const removed = await call<{afterDuration: number}>('edit_timeline_ranges', {revision: before.revision, operation: 'remove', ranges: [{start: 30, end: 45}], apply: false});
    expect(removed.afterDuration).toBe(75); expect((await project()).revision).toBe(before.revision);
    await call('edit_timeline_ranges', {revision: before.revision, operation: 'remove', ranges: [{start: 30, end: 45}], apply: true});
    expect((await project()).clips.find(clip => clip.kind === 'audio')?.start).toBe(30);
    expect((await project()).clips.find(clip => clip.id.startsWith('camera-top-range-'))).toMatchObject({start: 30, sourceStart: 45, audioEnvelope: {offset: 45}});
    await call('undo_redo', {revision: (await project()).revision, direction: 'undo'});
    await call('edit_timeline_ranges', {revision: (await project()).revision, operation: 'assemble', ranges: [{start: 45, end: 90}, {start: 0, end: 45}], apply: true});
    expect((await project()).clips.find(clip => clip.id === 'camera-b')?.start).toBe(0);
    expect((await project()).clips.find(clip => clip.id === 'camera-a')?.start).toBe(45);
    await call('undo_redo', {revision: (await project()).revision, direction: 'undo'});
    await call('duck_audio', {revision: (await project()).revision, targetClipIds: ['camera-top'], triggerTrackIds: ['audio'], gain: .25, attackFrames: 6, releaseFrames: 12, apply: true});
    expect((await project()).clips.find(clip => clip.id === 'camera-top')?.audioEnvelope?.keyframes).toContainEqual({frame: 45, value: .25});
    await call('undo_redo', {revision: (await project()).revision, direction: 'undo'});
    const effects = {equalizer: {low: 2, mid: -1, high: 1}, compressor: {threshold: -18, ratio: 3}, reverb: {wet: .15, room: .4}};
    await call('edit_project', {revision: (await project()).revision, label: 'Detach audio', commands: [{type: 'clip.detach-audio', id: 'camera-b', newClipId: 'detached-audio', newAssetId: 'detached-source', linkId: 'detached-link'}]});
    const extracted = await project(); const videoB = extracted.clips.find(c => c.id === 'camera-b')!;
    const detached = extracted.clips.find(c => c.kind === 'audio' && c.linkId === videoB.linkId)!;
    expect(detached).toMatchObject({sourceStart: 45, start: 45, duration: 45});
    expect(extracted.assets.find(a => a.id === detached.assetId)!.duration).toBeGreaterThanOrEqual(3);
    expect(extracted.assets.find(a => a.id === detached.assetId)!.src).toBe(asset.src);
    await call('undo_redo', {revision: extracted.revision, direction: 'undo'});
    const started = await call<AudioEffectJob>('apply_audio_effects', {revision: (await project()).revision, clipIds: ['camera-top'], effects});
    let job = started;
    await expect.poll(async () => {job = await call<AudioEffectJob>('get_audio_effect_job', {id: started.id}); return job.status;}, {timeout: 30000}).toMatch(/done|error/);
    expect(job.status, job.error).toBe('done');
    const processed = await project();
    expect(processed.clips.find(clip => clip.id === 'camera-top')?.volume).toBe(0);
    const audio = processed.clips.find(clip => clip.id === job.clipIds?.[0])!;
    expect(audio).toMatchObject({kind: 'audio', start: 0, duration: 90, volume: .5, audioEnvelope: {fadeIn: 12}});
    expect(processed.assets.find(item => item.id === audio.assetId)?.audioProcessing?.sourceAssetId).toBe(asset.id);
    await page.goto('/');
    await page.locator('button[aria-label="Audio"]').click();
    await page.getByRole('button', {name: 'Sound library', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Preview Soft whoosh', exact: true})).toBeVisible();
    await page.locator(`[data-clip-id="${audio.id}"]`).click();
    const fade = page.getByRole('spinbutton', {name: 'Fade in', exact: true});
    await expect(fade).toHaveValue('0.4'); await fade.fill('0.6'); await fade.press('Enter');
    await expect.poll(async () => (await project()).clips.find(clip => clip.id === audio.id)?.audioEnvelope?.fadeIn).toBe(18);
    const render = await call<{id: string}>('export_video', {revision: (await project()).revision, settings: {width: 320, height: 180, fps: 30, audio: true}});
    let rendered: {status: string; error?: string; url?: string} = {status: 'queued'};
    await expect.poll(async () => {rendered = await (await request.get(`/api/render/${render.id}`)).json(); return rendered.status;}, {timeout: 120000}).toMatch(/done|error/);
    expect(rendered.status, rendered.error).toBe('done');
    const output = path.join(directory, 'audio-edit-export.mp4'); await writeFile(output, await (await request.get(rendered.url!)).body());
    const pcm = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', output, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const rms = (start: number, end: number) => {let sum = 0; for(let i = start * 48000; i < end * 48000; i++) sum += pcm.readFloatLE(i * 4) ** 2; return Math.sqrt(sum / ((end - start) * 48000));};
    expect(rms(.02, .1)).toBeLessThan(rms(.8, 1) * .3);
  } finally {await client.close();}
});
