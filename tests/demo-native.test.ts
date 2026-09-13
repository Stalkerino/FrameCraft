import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {expect, it} from 'vitest';
import {createDemo, normalizeDemoMedia} from '../shared/demo';
import {normalizeProjectTracks} from '../shared/tracks';
import {exportSettingsSchema} from '../shared/media-settings';
import {nativeScenePlan} from '../shared/native-scene-plan';
import {readStoredProject} from '../server/repositories/project-storage';
import {prepareDemoMedia} from '../server/services/demo-media-service';
import {prepareNativeImage} from '../server/services/rendering/native-image-service';

it('loads the bundled demo textures in the native image path and permits AMD/NVIDIA scene planning', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fc-demo-native-'));
  try {
    await prepareDemoMedia(process.cwd(), directory);
    const project = createDemo();
    for(const [index, asset] of project.assets.entries()) {
      const rgba = await prepareNativeImage(path.join(directory, path.basename(asset.src)), asset, directory, index);
      expect((await readFile(rgba)).length).toBe(1920 * 1080 * 4);
    }
    for(const encoder of ['amd', 'nvidia'] as const) expect(nativeScenePlan(project, exportSettingsSchema.parse({renderer: 'native-vulkan', encoder, width: 1920, height: 1080, fps: 30})).blockers).toEqual([]);
  } finally {await rm(directory, {recursive: true, force: true});}
});

it('upgrades old demo references and history on load while retaining edits and unrelated SVGs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fc-demo-migration-'));
  try {
    const project = normalizeProjectTracks(createDemo()); project.name = 'My edited example'; project.revision = 12; project.clips[0].duration = 140;
    project.assets = project.assets.map(asset => ({...asset, name: asset.name.replace('.png', '.svg'), src: asset.src.replace('.png', '.svg'), thumbnail: asset.thumbnail?.replace('.png', '.svg')}));
    const file = path.join(directory, 'project.json');
    await writeFile(file, JSON.stringify({project, past: [project], future: [project], activity: [], updatedAt: '2026-09-13T00:00:00Z'}));
    const result = await readStoredProject(file);
    for(const state of [result.project, ...result.past, ...result.future]) {
      expect(state.assets.every(asset => asset.src.endsWith('.png'))).toBe(true);
      expect(state.clips).toEqual(project.clips); expect(state.name).toBe(project.name); expect(state.revision).toBe(12);
    }
    const unrelated = {...project, assets: [{...project.assets[0], demo: false}, {...project.assets[1], src: '/media/custom.svg'}]};
    expect(normalizeDemoMedia(unrelated).assets).toEqual(unrelated.assets);
  } finally {await rm(directory, {recursive: true, force: true});}
});
